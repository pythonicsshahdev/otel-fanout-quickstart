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
