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
  dynatrace: [
    { key: 'endpoint', label: 'OTLP Endpoint', placeholder: 'https://{env-id}.live.dynatrace.com/api/v2/otlp' },
    { key: 'api_token', label: 'API Token', placeholder: 'dt0c01.your-token', type: 'password' }
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
  dynatrace: 'Dynatrace',
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
