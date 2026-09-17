const path = require('path');
const { renderConfig } = require('../config-renderer');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../otel-collector-config.hbs');

const BASE_CONSUMERS = {
  opensearch: { enabled: true, endpoint: 'http://opensearch:9200' },
  splunk: { enabled: false, endpoint: '', token: '' },
  newrelic: { enabled: false, license_key: '' },
  datadog: { enabled: false, api_key: '', site: 'datadoghq.com' },
  dynatrace: { enabled: false, endpoint: '', api_token: '' },
  prometheus: { enabled: false, endpoint: '' }
};

test('renders a traces-only pipeline against opensearch', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).toContain('opensearch/traces');
  // Logs and metrics moved to Vector; the collector's elasticsearch exporter is
  // incompatible with OpenSearch 3.5, so these must never come back.
  expect(yaml).not.toContain('elasticsearch/logs');
  expect(yaml).not.toContain('elasticsearch/metrics');
  const pipelines = yaml.split('pipelines:')[1];
  expect(pipelines).toContain('traces:');
  expect(pipelines).not.toContain('logs:');
  expect(pipelines).not.toContain('metrics:');
});

test('renders both OTTL transforms ahead of batch in the traces pipeline', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).toContain('transform/boomi_numeric');
  expect(yaml).toContain('transform/boomi_usf_fields');
  // Order matters: attributes must be normalised before batching/export.
  const tracesPipeline = yaml.split('pipelines:')[1].split('traces:')[1];
  expect(tracesPipeline).toContain('processors: [transform/boomi_numeric, transform/boomi_usf_fields, batch]');
});

test('derives duration_ms and coerces document counts to numbers', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).toContain('set(span.attributes["duration_ms"], (span.end_time_unix_nano - span.start_time_unix_nano) / 1000000.0)');
  for (const field of ['inboundDocumentCount', 'outboundDocumentCount', 'inboundDocumentSize', 'outboundDocumentSize']) {
    expect(yaml).toContain(`Int(span.attributes["processStep.${field}"])`);
  }
});

test('extracts the business dimensions carried in Notify messages', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  for (const field of ['consumerId', 'subConsumerId', 'correlationId', 'transactionId', 'txn',
                       'responseCode', 'httpStatus', 'endPoint', 'scenario', 'divisionNbr', 'priced']) {
    expect(yaml).toContain(`(?P<${field}>`);
  }
  // Handlebars must not mangle the regex escapes.
  expect(yaml).toContain('[|][ ]*consumerId=');
});

test('does not render disabled consumers', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).not.toContain('splunk_hec');
  expect(yaml).not.toContain('otlp/newrelic');
  expect(yaml).not.toContain('datadog/datadog');
  expect(yaml).not.toContain('otlphttp/dynatrace');
});

test('renders splunk exporter when enabled', () => {
  const consumers = { ...BASE_CONSUMERS, splunk: { enabled: true, endpoint: 'https://hec.example.com:8088', token: 'tok-123' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('splunk_hec/splunk');
  expect(yaml).toContain('tok-123');
  expect(yaml).toContain('https://hec.example.com:8088');
  expect(yaml.split('pipelines:')[1].split('traces:')[1]).toContain('splunk_hec/splunk');
});

test('renders dynatrace over otlphttp, not otlp', () => {
  const consumers = { ...BASE_CONSUMERS, dynatrace: { enabled: true, endpoint: 'https://abc.live.dynatrace.com/api/v2/otlp', api_token: 'dt0c01.xyz' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('otlphttp/dynatrace');
  expect(yaml).not.toContain('otlp/dynatrace:');
  expect(yaml).toContain('Api-Token dt0c01.xyz');
});

// Known gap, tracked as defect 7.4: the UI exposes a Prometheus consumer card,
// but the template has no prometheusremotewrite block, so enabling it writes
// state nothing reads. This asserts the current behaviour so that implementing
// the exporter fails here and forces the test to be updated deliberately.
test('prometheus consumer is not implemented in the template (defect 7.4)', () => {
  const consumers = { ...BASE_CONSUMERS, prometheus: { enabled: true, endpoint: 'http://prom:9090/api/v1/write' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).not.toContain('prometheusremotewrite');
});

test('renders correct opensearch endpoint from consumers', () => {
  const consumers = { ...BASE_CONSUMERS, opensearch: { enabled: true, endpoint: 'http://my-opensearch:9200' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('http://my-opensearch:9200');
});
