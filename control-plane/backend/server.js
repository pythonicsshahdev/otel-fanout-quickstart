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
    const tmpPath = CONFIG_OUTPUT_PATH + '.tmp';
    fs.writeFileSync(tmpPath, yaml);
    fs.renameSync(tmpPath, CONFIG_OUTPUT_PATH);

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

app.listen(3001, () => console.log('Control plane backend on :3001'));
