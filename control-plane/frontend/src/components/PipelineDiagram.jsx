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
  dynatrace: 'Dynatrace',
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
