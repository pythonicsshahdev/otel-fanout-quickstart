import React, { useEffect, useState } from 'react';

export default function RetentionSettings() {
  const [days, setDays] = useState('');
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch('/api/retention')
      .then(r => r.json())
      .then(d => { if (d.days) { setDays(String(d.days)); setSaved(d.days); } })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/retention', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: parseInt(days) })
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) {
      setSaved(parseInt(days));
      setMessage({ type: 'success', text: `Retention set to ${days} days` });
    } else {
      setMessage({ type: 'error', text: data.error || 'Failed to update' });
    }
  }

  const changed = days && parseInt(days) !== saved;

  return (
    <div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Indices older than this many days are automatically deleted from OpenSearch.
        Applies to <code style={{ color: '#94a3b8' }}>boomi-logs-*</code>, <code style={{ color: '#94a3b8' }}>boomi-metrics-*</code>, and <code style={{ color: '#94a3b8' }}>ss4o_traces-*</code>.
      </p>

      <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
        Retention period (days)
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input
          type="number"
          min="1"
          value={days}
          onChange={e => setDays(e.target.value)}
          placeholder={saved ? String(saved) : 'e.g. 30'}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 6,
            background: '#0f172a', border: '1px solid #334155',
            color: '#e2e8f0', fontSize: 14
          }}
        />
        <span style={{ fontSize: 12, color: '#64748b' }}>days</span>
      </div>

      {saved && !changed && (
        <p style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
          Current: {saved} days
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !days || !changed}
        style={{
          width: '100%', padding: 10, borderRadius: 6, border: 'none',
          background: saving || !changed ? '#334155' : '#3b82f6',
          color: '#fff', cursor: saving || !changed ? 'not-allowed' : 'pointer',
          fontSize: 14, fontWeight: 600
        }}
      >
        {saving ? 'Saving...' : 'Save Retention Policy'}
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
  );
}
