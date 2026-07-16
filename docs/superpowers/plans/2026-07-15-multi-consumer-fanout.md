# Multi-Consumer Fan-Out + Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Boomi observability stack into a toggle-driven multi-consumer fan-out system with a React control plane UI, where Vector preprocesses logs/metrics and OTel Collector fans out all signals to any combination of OpenSearch, Splunk, New Relic, Datadog, and Prometheus.

**Architecture:** Vector transforms OTLP logs/metrics via VRL and forwards to OTel Collector over internal gRPC port 4321. OTel Collector is the single fan-out hub, its config generated from a Handlebars template rendered against `consumers.json`. A React + Node.js control plane container (port 8080) lets users toggle consumers, persists credentials in a named Docker volume, and restarts the collector via Docker socket on changes.

**Tech Stack:** Docker Compose, Vector (VRL), OTel Collector Contrib, Handlebars.js 4.x, Node.js 20 / Express 4.x, dockerode 4.x, React 18, Vite 5, ReactFlow 11

## Global Constraints

- All containers on `boomi-net` Docker bridge network
- OpenSearch is always enabled — never behind a conditional in the template
- `consumers.json` schema must be flat JSON (ConfigMap-portable for OpenShift)
- `DEPLOY_TARGET=compose` env var on control-plane container (reserved for `openshift` variant)
- No auth on control plane UI (dev/POC scope)
- Vector container ports: `4317` (gRPC logs/metrics), `4318` (HTTP logs/metrics)
- OTel Collector container port `4321` receives from Vector (internal, not exposed to host)
- OTel Collector host-exposed ports: `4319→4317` (gRPC traces from Boomi), `4320→4318` (HTTP traces from Boomi)
- OTel Collector port `8888` exposes Prometheus metrics (internal, for `/api/status`)
- Control Plane UI host port: `8080`
- `otel-collector-config.yaml` is a bind-mounted file on the host; both otel-collector and control-plane mount it — control-plane writes it, otel-collector reads it on restart

---

### Task 1: Handlebars Template + consumers.default.json

**Files:**
- Create: `otel-collector-config.hbs`
- Create: `consumers.default.json`
- Modify: `otel-collector-config.yaml` (replaced with the rendered output of the template + defaults)
- Modify: `grafana/provisioning/datasources/datasources.yml` (update index patterns to match new static names)

**Interfaces:**
- Produces: `otel-collector-config.hbs` consumed by Task 3's `config-renderer.js` via `renderConfig(consumers, templatePath) => string`

- [ ] **Step 1: Create `consumers.default.json`**

```json
{
  "consumers": {
    "opensearch": { "enabled": true, "endpoint": "http://opensearch:9200" },
    "splunk": { "enabled": false, "endpoint": "", "token": "" },
    "newrelic": { "enabled": false, "license_key": "" },
    "datadog": { "enabled": false, "api_key": "", "site": "datadoghq.com" },
    "prometheus": { "enabled": false, "endpoint": "" }
  }
}
```

- [ ] **Step 2: Create `otel-collector-config.hbs`**

```handlebars
receivers:
  otlp/from_vector:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4321
  otlp/from_boomi:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  elasticsearch/logs:
    endpoints: ["{{consumers.opensearch.endpoint}}"]
    logs_index: boomi-logs
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
  elasticsearch/metrics:
    endpoints: ["{{consumers.opensearch.endpoint}}"]
    logs_index: boomi-metrics
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
  opensearch/traces:
    http:
      endpoint: "{{consumers.opensearch.endpoint}}"
      timeout: 30s
    logs_index: boomi-traces
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
{{#if consumers.splunk.enabled}}
  splunk_hec/splunk:
    token: "{{consumers.splunk.token}}"
    endpoint: "{{consumers.splunk.endpoint}}"
    source: boomi
    sourcetype: _json
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
{{/if}}
{{#if consumers.newrelic.enabled}}
  otlp/newrelic:
    endpoint: https://otlp.nr-data.net:4317
    headers:
      api-key: "{{consumers.newrelic.license_key}}"
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
{{/if}}
{{#if consumers.datadog.enabled}}
  datadog/datadog:
    api:
      key: "{{consumers.datadog.api_key}}"
      site: "{{consumers.datadog.site}}"
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
{{/if}}
{{#if consumers.prometheus.enabled}}
  prometheusremotewrite/prometheus:
    endpoint: "{{consumers.prometheus.endpoint}}"
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
{{/if}}

service:
  telemetry:
    metrics:
      address: 0.0.0.0:8888
  pipelines:
    logs:
      receivers: [otlp/from_vector]
      processors: [batch]
      exporters: [elasticsearch/logs{{#if consumers.splunk.enabled}}, splunk_hec/splunk{{/if}}{{#if consumers.newrelic.enabled}}, otlp/newrelic{{/if}}{{#if consumers.datadog.enabled}}, datadog/datadog{{/if}}]
    metrics:
      receivers: [otlp/from_vector]
      processors: [batch]
      exporters: [elasticsearch/metrics{{#if consumers.splunk.enabled}}, splunk_hec/splunk{{/if}}{{#if consumers.newrelic.enabled}}, otlp/newrelic{{/if}}{{#if consumers.datadog.enabled}}, datadog/datadog{{/if}}{{#if consumers.prometheus.enabled}}, prometheusremotewrite/prometheus{{/if}}]
    traces:
      receivers: [otlp/from_boomi]
      processors: [batch]
      exporters: [opensearch/traces{{#if consumers.splunk.enabled}}, splunk_hec/splunk{{/if}}{{#if consumers.newrelic.enabled}}, otlp/newrelic{{/if}}{{#if consumers.datadog.enabled}}, datadog/datadog{{/if}}]
```

- [ ] **Step 3: Replace `otel-collector-config.yaml` with the rendered default output**

This is the template rendered with all toggles off (only OpenSearch enabled). Replace the entire file:

```yaml
receivers:
  otlp/from_vector:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4321
  otlp/from_boomi:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  elasticsearch/logs:
    endpoints: ["http://opensearch:9200"]
    logs_index: boomi-logs
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
  elasticsearch/metrics:
    endpoints: ["http://opensearch:9200"]
    logs_index: boomi-metrics
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true
  opensearch/traces:
    http:
      endpoint: "http://opensearch:9200"
      timeout: 30s
    logs_index: boomi-traces
    sending_queue:
      enabled: true
    retry_on_failure:
      enabled: true

service:
  telemetry:
    metrics:
      address: 0.0.0.0:8888
  pipelines:
    logs:
      receivers: [otlp/from_vector]
      processors: [batch]
      exporters: [elasticsearch/logs]
    metrics:
      receivers: [otlp/from_vector]
      processors: [batch]
      exporters: [elasticsearch/metrics]
    traces:
      receivers: [otlp/from_boomi]
      processors: [batch]
      exporters: [opensearch/traces]
```

- [ ] **Step 4: Update Grafana datasource index patterns**

The index names changed from `boomi-logs-YYYY-MM-DD` (Vector date pattern) to static `boomi-logs` / `boomi-metrics`. Update `grafana/provisioning/datasources/datasources.yml`:

```yaml
apiVersion: 1

datasources:
  - name: OpenSearch Logs
    type: grafana-opensearch-datasource
    access: proxy
    url: http://opensearch:9200
    isDefault: true
    jsonData:
      timeField: ingestion_timestamp
      version: 2.0.0
      logMessageField: body
      logLevelField: severity_text
      database: boomi-logs
    editable: true

  - name: OpenSearch Metrics
    type: grafana-opensearch-datasource
    access: proxy
    url: http://opensearch:9200
    jsonData:
      timeField: ingestion_timestamp
      version: 2.0.0
      database: boomi-metrics
    editable: true

  - name: OpenSearch Traces
    type: grafana-opensearch-datasource
    access: proxy
    url: http://opensearch:9200
    jsonData:
      timeField: ingestion_timestamp
      version: 2.0.0
      database: boomi-traces
    editable: true
```

- [ ] **Step 5: Commit**

```bash
git add otel-collector-config.hbs consumers.default.json otel-collector-config.yaml grafana/provisioning/datasources/datasources.yml
git commit -m "feat: add handlebars template and consumers config, update grafana datasources"
```

---

### Task 2: Rewire vector.toml to Forward to OTel Collector

**Files:**
- Modify: `vector.toml`

**Interfaces:**
- Consumes: OTel Collector gRPC at `http://otel-collector:4321`
- Produces: OTLP stream of transformed logs and metrics → OTel Collector port 4321

- [ ] **Step 1: Replace `vector.toml` entirely**

```toml
[sources.boomi_otel]
type = "opentelemetry"

[sources.boomi_otel.grpc]
address = "0.0.0.0:4317"

[sources.boomi_otel.http]
address = "0.0.0.0:4318"

[transforms.logs_transformed]
type = "remap"
inputs = ["boomi_otel.logs"]
source = '''
.ingestion_timestamp = now()
.data_source = "boomi"

if exists(.attributes) {
  .attributes_raw = encode_json(.attributes)
  del(.attributes)
}
'''

[transforms.metrics_transformed]
type = "remap"
inputs = ["boomi_otel.metrics"]
source = '''
.ingestion_timestamp = now()
.data_source = "boomi"
'''

[sinks.otel_collector_forward]
type = "opentelemetry"
inputs = ["logs_transformed", "metrics_transformed"]
endpoint = "http://otel-collector:4321"
```

- [ ] **Step 2: Validate the config syntax**

```bash
docker run --rm \
  -v $(pwd)/vector.toml:/etc/vector/vector.toml \
  timberio/vector:latest-alpine \
  validate --config /etc/vector/vector.toml
```

Expected output: `✓ Loaded [/etc/vector/vector.toml]`

If the `opentelemetry` sink validation fails with "unknown component type", the installed Vector version is older than 0.39. In that case, replace the sink with the `http` sink pointing to OTel Collector's HTTP endpoint:

```toml
[sinks.otel_collector_forward]
type = "http"
inputs = ["logs_transformed", "metrics_transformed"]
uri = "http://otel-collector:4321"
encoding.codec = "json"
```

- [ ] **Step 3: Commit**

```bash
git add vector.toml
git commit -m "feat: rewire vector to forward logs/metrics to otel-collector via otlp"
```

---

### Task 3: Control Plane Backend (Node.js/Express)

**Files:**
- Create: `control-plane/backend/package.json`
- Create: `control-plane/backend/config-renderer.js`
- Create: `control-plane/backend/docker-client.js`
- Create: `control-plane/backend/server.js`
- Create: `control-plane/backend/__tests__/config-renderer.test.js`

**Interfaces:**
- Consumes:
  - `/data/consumers.json` (named volume mount)
  - `/templates/otel-collector-config.hbs` (bind mount, read-only)
  - `/config/otel-collector-config.yaml` (bind mount to `./otel-collector-config.yaml` on host)
  - `/var/run/docker.sock` (Docker socket)
- Produces:
  - `GET /api/consumers` → `{ consumers: object }`
  - `POST /api/consumers` body `{ consumers: object }` → `{ ok: boolean, error?: string }`
  - `GET /api/status` → `{ collector: { healthy: boolean, exporterErrors: Record<string, number> } }`
  - `renderConfig(consumers: object, templatePath: string): string` (exported from config-renderer.js)

- [ ] **Step 1: Create `control-plane/backend/package.json`**

```json
{
  "name": "boomi-control-plane-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "jest --testEnvironment node"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dockerode": "^4.0.2",
    "express": "^4.18.2",
    "handlebars": "^4.7.8"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Write the failing test for config-renderer**

Create `control-plane/backend/__tests__/config-renderer.test.js`:

```js
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
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd control-plane/backend && npm install && npm test
```

Expected: FAIL — `Cannot find module '../config-renderer'`

- [ ] **Step 4: Implement `config-renderer.js`**

```js
const Handlebars = require('handlebars');
const fs = require('fs');

function renderConfig(consumers, templatePath) {
  const source = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(source);
  return template({ consumers });
}

module.exports = { renderConfig };
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test
```

Expected: 5 tests PASS.

- [ ] **Step 6: Implement `docker-client.js`**

```js
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function restartContainer(name) {
  const container = docker.getContainer(name);
  await container.restart({ t: 10 });
}

async function waitForRunning(name, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await docker.getContainer(name).inspect();
      if (info.State.Running) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

module.exports = { restartContainer, waitForRunning };
```

- [ ] **Step 7: Implement `server.js`**

```js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { renderConfig } = require('./config-renderer');
const { restartContainer, waitForRunning } = require('./docker-client');

const app = express();
app.use(cors());
app.use(express.json());

const CONSUMERS_PATH = process.env.CONSUMERS_PATH || '/data/consumers.json';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/templates/otel-collector-config.hbs';
const CONFIG_OUTPUT_PATH = process.env.CONFIG_OUTPUT_PATH || '/config/otel-collector-config.yaml';
const COLLECTOR_CONTAINER = process.env.COLLECTOR_CONTAINER || 'otel-collector';
const DEFAULT_CONSUMERS = path.join(__dirname, 'consumers.default.json');

function ensureConsumers() {
  if (!fs.existsSync(CONSUMERS_PATH)) {
    fs.mkdirSync(path.dirname(CONSUMERS_PATH), { recursive: true });
    fs.copyFileSync(DEFAULT_CONSUMERS, CONSUMERS_PATH);
  }
}

function readConsumers() {
  ensureConsumers();
  return JSON.parse(fs.readFileSync(CONSUMERS_PATH, 'utf8')).consumers;
}

app.get('/api/consumers', (req, res) => {
  try {
    res.json({ consumers: readConsumers() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/consumers', async (req, res) => {
  const { consumers } = req.body;
  const backupPath = CONFIG_OUTPUT_PATH + '.bak';

  try {
    if (fs.existsSync(CONFIG_OUTPUT_PATH)) {
      fs.copyFileSync(CONFIG_OUTPUT_PATH, backupPath);
    }

    fs.writeFileSync(CONSUMERS_PATH, JSON.stringify({ consumers }, null, 2));

    const yaml = renderConfig(consumers, TEMPLATE_PATH);
    fs.writeFileSync(CONFIG_OUTPUT_PATH, yaml);

    await restartContainer(COLLECTOR_CONTAINER);
    const running = await waitForRunning(COLLECTOR_CONTAINER);

    if (!running) {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, CONFIG_OUTPUT_PATH);
        await restartContainer(COLLECTOR_CONTAINER);
      }
      return res.status(500).json({ ok: false, error: 'Collector failed to restart; config rolled back' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch(`http://${COLLECTOR_CONTAINER}:8888/metrics`);
    const text = await response.text();
    const exporterErrors = {};
    for (const line of text.split('\n')) {
      const match = line.match(/otelcol_exporter_send_failed_\w+\{.*?exporter="([^"]+)".*?\}\s+(\d+)/);
      if (match) exporterErrors[match[1]] = parseInt(match[2], 10);
    }
    res.json({ collector: { healthy: true, exporterErrors } });
  } catch {
    res.json({ collector: { healthy: false, exporterErrors: {} } });
  }
});

app.listen(3001, () => console.log('Control plane backend on :3001'));
```

- [ ] **Step 8: Copy consumers.default.json into the backend directory so it's available in the container**

```bash
cp consumers.default.json control-plane/backend/consumers.default.json
```

- [ ] **Step 9: Commit**

```bash
git add control-plane/backend/
git commit -m "feat: add control plane backend with config rendering and collector restart"
```

---

### Task 4: Control Plane Frontend (React + Vite + ReactFlow)

**Files:**
- Create: `control-plane/frontend/package.json`
- Create: `control-plane/frontend/vite.config.js`
- Create: `control-plane/frontend/index.html`
- Create: `control-plane/frontend/src/main.jsx`
- Create: `control-plane/frontend/src/api.js`
- Create: `control-plane/frontend/src/App.jsx`
- Create: `control-plane/frontend/src/components/ConsumerCard.jsx`
- Create: `control-plane/frontend/src/components/PipelineDiagram.jsx`

**Interfaces:**
- Consumes: `GET /api/consumers`, `POST /api/consumers`, `GET /api/status`
- Produces: static build at `control-plane/frontend/dist/` served by nginx

- [ ] **Step 1: Create `control-plane/frontend/package.json`**

```json
{
  "name": "boomi-control-plane-ui",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "reactflow": "^11.11.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.2"
  }
}
```

- [ ] **Step 2: Create `control-plane/frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3001' }
  }
});
```

- [ ] **Step 3: Create `control-plane/frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Boomi Observability Control Plane</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `control-plane/frontend/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
```

- [ ] **Step 5: Create `control-plane/frontend/src/api.js`**

```js
export async function getConsumers() {
  const res = await fetch('/api/consumers');
  return res.json();
}

export async function saveConsumers(consumers) {
  const res = await fetch('/api/consumers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumers })
  });
  return res.json();
}

export async function getStatus() {
  const res = await fetch('/api/status');
  return res.json();
}
```

- [ ] **Step 6: Create `control-plane/frontend/src/components/ConsumerCard.jsx`**

```jsx
import React from 'react';

const FIELDS = {
  opensearch: [{ key: 'endpoint', label: 'Endpoint', placeholder: 'http://opensearch:9200' }],
  splunk: [
    { key: 'endpoint', label: 'HEC Endpoint', placeholder: 'https://splunk.example.com:8088' },
    { key: 'token', label: 'HEC Token', placeholder: 'your-hec-token', type: 'password' }
  ],
  newrelic: [
    { key: 'license_key', label: 'License Key', placeholder: 'your-license-key', type: 'password' }
  ],
  datadog: [
    { key: 'api_key', label: 'API Key', placeholder: 'your-api-key', type: 'password' },
    { key: 'site', label: 'Site', placeholder: 'datadoghq.com' }
  ],
  prometheus: [
    { key: 'endpoint', label: 'Remote Write URL', placeholder: 'http://prometheus:9090/api/v1/write' }
  ]
};

const LABELS = {
  opensearch: 'OpenSearch',
  splunk: 'Splunk',
  newrelic: 'New Relic',
  datadog: 'Datadog',
  prometheus: 'Prometheus (metrics only)'
};

export default function ConsumerCard({ name, config, onChange, alwaysOn }) {
  return (
    <div style={{
      background: '#1e293b',
      border: `1px solid ${config.enabled ? '#22c55e' : '#334155'}`,
      borderRadius: 8,
      padding: 16,
      marginBottom: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>{LABELS[name] ?? name}</strong>
        {alwaysOn
          ? <span style={{ fontSize: 12, color: '#22c55e' }}>Always On</span>
          : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!config.enabled}
                onChange={e => onChange(name, { ...config, enabled: e.target.checked })}
              />
              {config.enabled ? 'Enabled' : 'Disabled'}
            </label>
          )}
      </div>
      {(FIELDS[name] ?? []).map(f => (
        <div key={f.key} style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{f.label}</label>
          <input
            type={f.type ?? 'text'}
            value={config[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={e => onChange(name, { ...config, [f.key]: e.target.value })}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 4,
              border: '1px solid #334155', background: '#0f172a',
              color: '#e2e8f0', fontSize: 13
            }}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create `control-plane/frontend/src/components/PipelineDiagram.jsx`**

```jsx
import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

const BOX = {
  background: '#1e293b', border: '1px solid #475569',
  borderRadius: 8, padding: '10px 16px', color: '#e2e8f0', fontSize: 12
};

const CONSUMER_LABELS = {
  opensearch: 'OpenSearch\n:9200',
  splunk: 'Splunk HEC',
  newrelic: 'New Relic',
  datadog: 'Datadog',
  prometheus: 'Prometheus\n(metrics only)'
};

export default function PipelineDiagram({ consumers, collectorHealthy }) {
  const { nodes, edges } = useMemo(() => {
    const enabled = Object.entries(consumers).filter(([, c]) => c.enabled);

    const nodes = [
      { id: 'boomi', position: { x: 0, y: 120 }, data: { label: 'Boomi Atom' }, style: BOX },
      { id: 'vector', position: { x: 220, y: 60 }, data: { label: 'Vector\n:4317/:4318\nlogs + metrics' }, style: BOX },
      {
        id: 'otel', position: { x: 220, y: 180 },
        data: { label: 'OTel Collector\n:4319/:4320 traces' },
        style: { ...BOX, border: `1px solid ${collectorHealthy ? '#22c55e' : '#ef4444'}` }
      },
      ...enabled.map(([name], i) => ({
        id: `c_${name}`, position: { x: 460, y: i * 90 },
        data: { label: CONSUMER_LABELS[name] ?? name },
        style: BOX
      }))
    ];

    const edges = [
      { id: 'b-v', source: 'boomi', target: 'vector', label: 'OTLP logs/metrics', animated: true },
      { id: 'b-o', source: 'boomi', target: 'otel', label: 'OTLP traces', animated: true },
      { id: 'v-o', source: 'vector', target: 'otel', label: 'OTLP :4321', animated: true },
      ...enabled.map(([name]) => ({
        id: `o-${name}`, source: 'otel', target: `c_${name}`, animated: collectorHealthy
      }))
    ];

    return { nodes, edges };
  }, [consumers, collectorHealthy]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 8: Create `control-plane/frontend/src/App.jsx`**

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import ConsumerCard from './components/ConsumerCard';
import PipelineDiagram from './components/PipelineDiagram';
import { getConsumers, saveConsumers, getStatus } from './api';

export default function App() {
  const [consumers, setConsumers] = useState(null);
  const [collectorHealthy, setCollectorHealthy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const pollStatus = useCallback(() => {
    getStatus().then(d => setCollectorHealthy(d.collector.healthy)).catch(() => setCollectorHealthy(false));
  }, []);

  useEffect(() => {
    getConsumers().then(d => setConsumers(d.consumers));
    pollStatus();
    const id = setInterval(pollStatus, 5000);
    return () => clearInterval(id);
  }, [pollStatus]);

  function handleChange(name, updated) {
    setConsumers(prev => ({ ...prev, [name]: updated }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await saveConsumers(consumers);
    setSaving(false);
    setMessage(result.ok
      ? { type: 'success', text: 'Saved — collector restarted successfully' }
      : { type: 'error', text: result.error ?? 'Unknown error' }
    );
    if (result.ok) pollStatus();
  }

  if (!consumers) {
    return <div style={{ padding: 32, color: '#94a3b8' }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 340, padding: 20, overflowY: 'auto', borderRight: '1px solid #1e293b', flexShrink: 0 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, marginBottom: 2 }}>Boomi Observability</h1>
        <p style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>
          Consumer Control Plane · Collector {collectorHealthy ? '🟢 healthy' : '🔴 unreachable'}
        </p>

        {Object.entries(consumers).map(([name, config]) => (
          <ConsumerCard
            key={name}
            name={name}
            config={config}
            onChange={handleChange}
            alwaysOn={name === 'opensearch'}
          />
        ))}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: 10, borderRadius: 6, border: 'none',
            background: saving ? '#334155' : '#3b82f6', color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
          }}
        >
          {saving ? 'Applying...' : 'Save & Apply'}
        </button>

        {message && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 6, fontSize: 13,
            background: message.type === 'success' ? '#14532d' : '#450a0a',
            color: message.type === 'success' ? '#86efac' : '#fca5a5'
          }}>
            {message.text}
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <PipelineDiagram consumers={consumers} collectorHealthy={collectorHealthy} />
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Build the frontend to verify it compiles cleanly**

```bash
cd control-plane/frontend && npm install && npm run build
```

Expected: `dist/` directory created with no build errors.

- [ ] **Step 10: Commit**

```bash
git add control-plane/frontend/
git commit -m "feat: add react control plane UI with consumer toggles and pipeline diagram"
```

---

### Task 5: Dockerfiles + nginx + Docker Compose Integration

**Files:**
- Create: `control-plane/nginx.conf`
- Create: `control-plane/Dockerfile`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `control-plane/frontend/dist/` (built static assets), `control-plane/backend/` (Node.js app)
- Produces: single container on port 8080; nginx serves React on `/`, proxies `/api/` to Node.js on `:3001`

- [ ] **Step 1: Create `control-plane/nginx.conf`**

```nginx
server {
    listen 8080;

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Create `control-plane/Dockerfile`**

```dockerfile
FROM node:20-alpine AS backend-deps
WORKDIR /app
COPY backend/package.json ./
RUN npm install --production

FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache nodejs

COPY --from=backend-deps /app/node_modules /app/backend/node_modules
COPY backend/ /app/backend/
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD sh -c "node /app/backend/server.js & nginx -g 'daemon off;'"
```

- [ ] **Step 3: Replace `docker-compose.yml` entirely**

```yaml
version: "3"
services:
  opensearch:
    image: opensearchproject/opensearch:latest
    container_name: opensearch
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true
      - "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
      - "9600:9600"
    networks:
      - boomi-net
    volumes:
      - opensearch-data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:latest
    container_name: opensearch-dashboards
    ports:
      - "5601:5601"
    environment:
      - OPENSEARCH_HOSTS=["http://opensearch:9200"]
      - DISABLE_SECURITY_DASHBOARDS_PLUGIN=true
    networks:
      - boomi-net
    depends_on:
      opensearch:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: otel-collector
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml
    ports:
      - "4319:4317"
      - "4320:4318"
    networks:
      - boomi-net
    depends_on:
      opensearch:
        condition: service_healthy
    restart: on-failure

  vector:
    image: timberio/vector:latest-alpine
    container_name: vector
    command: ["--config", "/etc/vector/vector.toml"]
    volumes:
      - ./vector.toml:/etc/vector/vector.toml
    ports:
      - "4317:4317"
      - "4318:4318"
    networks:
      - boomi-net
    depends_on:
      - otel-collector
    restart: on-failure

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ADMIN_USER=admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    networks:
      - boomi-net
    depends_on:
      - opensearch

  control-plane:
    build:
      context: ./control-plane
    container_name: control-plane
    ports:
      - "8080:8080"
    environment:
      - CONSUMERS_PATH=/data/consumers.json
      - TEMPLATE_PATH=/templates/otel-collector-config.hbs
      - CONFIG_OUTPUT_PATH=/config/otel-collector-config.yaml
      - COLLECTOR_CONTAINER=otel-collector
      - DEPLOY_TARGET=compose
    volumes:
      - consumers-data:/data
      - ./otel-collector-config.hbs:/templates/otel-collector-config.hbs:ro
      - ./otel-collector-config.yaml:/config/otel-collector-config.yaml
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - boomi-net
    depends_on:
      - otel-collector

networks:
  boomi-net:
    driver: bridge

volumes:
  opensearch-data:
  grafana-data:
  consumers-data:
```

- [ ] **Step 4: Build and bring up the full stack**

```bash
docker compose build control-plane
docker compose up -d
```

Expected: 6 containers start — opensearch, opensearch-dashboards, otel-collector, vector, grafana, control-plane.

Check all are running:

```bash
docker compose ps
```

Expected: all 6 show `Up` status.

- [ ] **Step 5: Verify the control plane UI**

Open `http://localhost:8080` in a browser.

Expected:
- Left panel shows 5 consumer cards: OpenSearch (marked "Always On"), Splunk, New Relic, Datadog, Prometheus (all disabled)
- Right panel shows a ReactFlow diagram: Boomi → Vector → OTel Collector → OpenSearch
- Collector status indicator shows green (healthy)

- [ ] **Step 6: Verify end-to-end telemetry flow**

Send a test OTLP log to Vector:

```bash
curl -s -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [{"key": "service.name", "value": {"stringValue": "boomi-test"}}]
      },
      "scopeLogs": [{
        "logRecords": [{
          "body": {"stringValue": "hello from boomi"},
          "severityText": "INFO"
        }]
      }]
    }]
  }'
```

Wait 5 seconds for the batch processor, then check OpenSearch:

```bash
curl -s http://localhost:9200/boomi-logs/_search?pretty | grep "hello from boomi"
```

Expected: the log body appears in the OpenSearch response.

- [ ] **Step 7: Verify toggle works end-to-end**

In the control plane UI at `http://localhost:8080`, enable Prometheus with endpoint `http://nonexistent:9090/api/v1/write`, click "Save & Apply". Wait for the spinner to resolve.

Expected:
- UI shows "Saved — collector restarted successfully"
- `otel-collector-config.yaml` on the host now contains `prometheusremotewrite/prometheus`
- Pipeline diagram now shows an edge from OTel Collector to Prometheus

Verify the rendered config on disk:

```bash
grep "prometheusremotewrite" otel-collector-config.yaml
```

Expected: line found.

- [ ] **Step 8: Commit**

```bash
git add control-plane/Dockerfile control-plane/nginx.conf docker-compose.yml
git commit -m "feat: wire control-plane container into docker-compose stack"
```
