const path = require('path');
const { renderConfig } = require('../config-renderer');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../otel-collector-config.hbs');

const BASE_CONSUMERS = {
  opensearch: { enabled: true, endpoint: 'http://opensearch:9200' },
  splunk: { enabled: false, endpoint: '', token: '' },
  newrelic: { enabled: false, license_key: '' },
  datadog: { enabled: false, api_key: '', site: 'datadoghq.com' },
  prometheus: { enabled: false, endpoint: '' }
};

test('always renders opensearch exporters', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).toContain('elasticsearch/logs');
  expect(yaml).toContain('elasticsearch/metrics');
  expect(yaml).toContain('opensearch/traces');
});

test('does not render disabled consumers', () => {
  const yaml = renderConfig(BASE_CONSUMERS, TEMPLATE_PATH);
  expect(yaml).not.toContain('splunk_hec');
  expect(yaml).not.toContain('otlp/newrelic');
  expect(yaml).not.toContain('datadog/datadog');
  expect(yaml).not.toContain('prometheusremotewrite');
});

test('renders splunk exporter when enabled', () => {
  const consumers = { ...BASE_CONSUMERS, splunk: { enabled: true, endpoint: 'https://hec.example.com:8088', token: 'tok-123' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('splunk_hec/splunk');
  expect(yaml).toContain('tok-123');
  expect(yaml).toContain('https://hec.example.com:8088');
});

test('renders prometheusremotewrite only in metrics pipeline', () => {
  const consumers = { ...BASE_CONSUMERS, prometheus: { enabled: true, endpoint: 'http://prom:9090/api/v1/write' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('prometheusremotewrite/prometheus');
  const metricsPipelineSection = yaml.split('metrics:')[1].split('traces:')[0];
  expect(metricsPipelineSection).toContain('prometheusremotewrite/prometheus');
  const tracesPipelineSection = yaml.split('traces:')[1];
  expect(tracesPipelineSection).not.toContain('prometheusremotewrite/prometheus');
});

test('renders correct opensearch endpoint from consumers', () => {
  const consumers = { ...BASE_CONSUMERS, opensearch: { enabled: true, endpoint: 'http://my-opensearch:9200' } };
  const yaml = renderConfig(consumers, TEMPLATE_PATH);
  expect(yaml).toContain('http://my-opensearch:9200');
});
