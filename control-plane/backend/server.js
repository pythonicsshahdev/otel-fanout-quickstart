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
const SOURCES_PATH = process.env.SOURCES_PATH || '/data/sources.json';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/templates/otel-collector-config.hbs';
const CONFIG_OUTPUT_PATH = process.env.CONFIG_OUTPUT_PATH || '/config/otel-collector-config.yaml';
const COLLECTOR_CONTAINER = process.env.COLLECTOR_CONTAINER || 'otel-collector';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
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

function readSources() {
  if (!fs.existsSync(SOURCES_PATH)) return { sources: {} };
  try { return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')); }
  catch { return { sources: {} }; }
}

function writeSources(data) {
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(data, null, 2));
}

async function discoverSources() {
  try {
    const res = await fetch(`${OPENSEARCH_URL}/boomi-logs-*/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size: 0,
        aggs: { sources: { terms: { field: 'resources.service.name.keyword', size: 50 } } }
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    const buckets = data?.aggregations?.sources?.buckets || [];
    const { sources } = readSources();
    const now = new Date().toISOString();
    for (const { key } of buckets) {
      if (!sources[key]) sources[key] = { label: key, discovered_at: now };
      sources[key].last_seen = now;
    }
    writeSources({ sources });
  } catch {}
}

setInterval(discoverSources, 30000);
discoverSources();

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
        const tmpRollback = CONFIG_OUTPUT_PATH + '.tmp';
        fs.copyFileSync(backupPath, tmpRollback);
        fs.renameSync(tmpRollback, CONFIG_OUTPUT_PATH);
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

app.get('/api/sources', (req, res) => {
  res.json(readSources());
});

app.post('/api/sources/:name', (req, res) => {
  const { name } = req.params;
  const { label } = req.body;
  const data = readSources();
  if (!data.sources[name]) return res.status(404).json({ error: 'Source not found' });
  if (label !== undefined) data.sources[name].label = label;
  writeSources(data);
  res.json({ ok: true });
});

app.delete('/api/sources/:name', (req, res) => {
  const { name } = req.params;
  const data = readSources();
  delete data.sources[name];
  writeSources(data);
  res.json({ ok: true });
});

app.listen(3001, () => console.log('Control plane backend on :3001'));
