import React, { useEffect, useState } from 'react';

export default function SourcesList() {
  const [sources, setSources] = useState({});
  const [lastSync, setLastSync] = useState(null);

  const load = () =>
    fetch('/api/sources')
      .then(r => r.json())
      .then(d => { setSources(d.sources || {}); setLastSync(new Date()); })
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const updateLabel = async (name, label) => {
    await fetch(`/api/sources/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    load();
  };

  const remove = async (name) => {
    await fetch(`/api/sources/${encodeURIComponent(name)}`, { method: 'DELETE' });
    load();
  };

  const isActive = (lastSeen) => {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 60000;
  };

  const entries = Object.entries(sources);

  return (
    <div>
      {lastSync && (
        <p style={{ fontSize: 11, color: '#475569', marginBottom: 12 }}>
          Last synced: {lastSync.toLocaleTimeString()}
        </p>
      )}
      {entries.length === 0 && (
        <p style={{ color: '#64748b', fontSize: 12 }}>
          No sources discovered yet. Sources appear automatically once telemetry arrives.
        </p>
      )}
      {entries.map(([name, src]) => (
        <div key={name} style={{
          marginBottom: 10, padding: 12,
          background: '#1e293b', borderRadius: 6,
          border: `1px solid ${isActive(src.last_seen) ? '#22c55e44' : '#334155'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: isActive(src.last_seen) ? '#22c55e' : '#475569'
            }} />
            <input
              defaultValue={src.label || name}
              onBlur={e => { if (e.target.value !== (src.label || name)) updateLabel(name, e.target.value); }}
              style={{
                background: 'transparent', border: 'none', color: '#e2e8f0',
                fontWeight: 600, fontSize: 13, width: '100%', outline: 'none'
              }}
            />
          </div>
          <div style={{ color: '#64748b', fontSize: 11, marginLeft: 14 }}>{name}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginLeft: 14 }}>
            Last seen: {src.last_seen ? new Date(src.last_seen).toLocaleString() : '—'}
          </div>
          <button
            onClick={() => remove(name)}
            style={{
              marginTop: 8, marginLeft: 14, fontSize: 11, color: '#64748b',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
