import React, { useEffect, useState, useCallback } from 'react';
import ConsumerCard from './components/ConsumerCard';
import PipelineDiagram from './components/PipelineDiagram';
import SourcesList from './components/SourcesList';
import RetentionSettings from './components/RetentionSettings';
import { getConsumers, saveConsumers, getStatus } from './api';

const TAB_STYLE = (active) => ({
  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
  background: active ? '#3b82f6' : 'transparent',
  color: active ? '#fff' : '#64748b'
});

export default function App() {
  const [consumers, setConsumers] = useState(null);
  const [collectorHealthy, setCollectorHealthy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [tab, setTab] = useState('consumers');

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
        <p style={{ fontSize: 12, color: '#475569', marginBottom: 16 }}>
          Consumer Control Plane · Collector {collectorHealthy ? '🟢 healthy' : '🔴 unreachable'}
        </p>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          <button style={TAB_STYLE(tab === 'consumers')} onClick={() => setTab('consumers')}>Trace Consumers</button>
          <button style={TAB_STYLE(tab === 'sources')} onClick={() => setTab('sources')}>Sources</button>
          <button style={TAB_STYLE(tab === 'retention')} onClick={() => setTab('retention')}>Retention</button>
        </div>

        {tab === 'consumers' && (
          <>
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
          </>
        )}

        {tab === 'sources' && <SourcesList />}
        {tab === 'retention' && <RetentionSettings />}
      </div>

      <div style={{ flex: 1 }}>
        <PipelineDiagram consumers={consumers} collectorHealthy={collectorHealthy} />
      </div>
    </div>
  );
}
