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
