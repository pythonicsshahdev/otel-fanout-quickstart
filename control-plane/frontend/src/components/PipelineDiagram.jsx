import React, { useEffect, useCallback } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState } from 'reactflow';
import 'reactflow/dist/style.css';

const PULSE_KEYFRAMES = `
@keyframes pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
}
@keyframes pulse-blue {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
}
`;

const BOX = {
  background: '#1e293b', border: '1px solid #475569',
  borderRadius: 8, padding: '10px 16px', color: '#e2e8f0', fontSize: 12
};

const CONSUMER_LABELS = {
  splunk: 'Splunk HEC',
  newrelic: 'New Relic',
  datadog: 'Datadog',
  dynatrace: 'Dynatrace',
  prometheus: 'Prometheus\n(metrics only)'
};

function loadPositions() {
  try { return JSON.parse(localStorage.getItem('pipeline-positions') || '{}'); }
  catch { return {}; }
}

function savePositions(pos) {
  localStorage.setItem('pipeline-positions', JSON.stringify(pos));
}

function makeNodes(consumers, collectorHealthy, positions) {
  const p = (id, def) => positions[id] || def;
  // Exclude opensearch — it's always present via Vector and OTel, not a toggle
  const enabled = Object.entries(consumers).filter(([k, c]) => c.enabled && k !== 'opensearch');

  return [
    {
      id: 'boomi',
      position: p('boomi', { x: 0, y: 160 }),
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: 'Boomi Atom' },
      style: { ...BOX, animation: 'pulse-blue 2s ease-in-out infinite' }
    },
    {
      id: 'vector',
      position: p('vector', { x: 300, y: 60 }),
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: 'Vector\n:4317/:4318\nlogs + metrics' },
      style: { ...BOX, animation: 'pulse-green 2s ease-in-out infinite' }
    },
    {
      id: 'otel',
      position: p('otel', { x: 300, y: 260 }),
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: 'OTel Collector\n:4319/:4320\ntraces + fanout' },
      style: {
        ...BOX,
        border: `1px solid ${collectorHealthy ? '#22c55e' : '#ef4444'}`,
        animation: collectorHealthy ? 'pulse-green 2s ease-in-out infinite' : 'none'
      }
    },
    {
      id: 'c_opensearch',
      position: p('c_opensearch', { x: 600, y: 160 }),
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: 'OpenSearch\n:9200' },
      style: { ...BOX, animation: 'pulse-green 2s ease-in-out infinite' }
    },
    ...enabled.map(([name], i) => ({
      id: `c_${name}`,
      position: p(`c_${name}`, { x: 600, y: 340 + i * 90 }),
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { label: CONSUMER_LABELS[name] ?? name },
      style: {
        ...BOX,
        animation: collectorHealthy ? 'pulse-green 2s ease-in-out infinite' : 'none'
      }
    }))
  ];
}

const EDGE = (extra = {}) => ({
  type: 'smoothstep',
  markerEnd: { type: 'arrowclosed', color: '#475569' },
  style: { stroke: '#475569' },
  ...extra
});

function makeEdges(consumers, collectorHealthy) {
  const enabled = Object.entries(consumers).filter(([k, c]) => c.enabled && k !== 'opensearch');
  return [
    EDGE({ id: 'b-v', source: 'boomi', target: 'vector', label: 'Logs/Metrics :4317/:4318', animated: true, style: { stroke: '#3b82f6' }, markerEnd: { type: 'arrowclosed', color: '#3b82f6' } }),
    EDGE({ id: 'b-o', source: 'boomi', target: 'otel', label: 'Traces :4319/:4320', animated: true, style: { stroke: '#3b82f6' }, markerEnd: { type: 'arrowclosed', color: '#3b82f6' } }),
    EDGE({ id: 'v-os', source: 'vector', target: 'c_opensearch', label: 'Logs/Metrics', animated: true, style: { stroke: '#22c55e' }, markerEnd: { type: 'arrowclosed', color: '#22c55e' } }),
    EDGE({ id: 'o-os', source: 'otel', target: 'c_opensearch', label: 'Traces', animated: collectorHealthy, style: { stroke: collectorHealthy ? '#22c55e' : '#475569' }, markerEnd: { type: 'arrowclosed', color: collectorHealthy ? '#22c55e' : '#475569' } }),
    ...enabled.map(([name]) =>
      EDGE({ id: `o-${name}`, source: 'otel', target: `c_${name}`, animated: collectorHealthy })
    )
  ];
}

export default function PipelineDiagram({ consumers, collectorHealthy }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(makeNodes(consumers, collectorHealthy, loadPositions()));
  const [edges, setEdges] = useEdgesState(makeEdges(consumers, collectorHealthy));

  useEffect(() => {
    setNodes(current => {
      const currentPos = {};
      current.forEach(n => { currentPos[n.id] = n.position; });
      return makeNodes(consumers, collectorHealthy, { ...loadPositions(), ...currentPos });
    });
    setEdges(makeEdges(consumers, collectorHealthy));
  }, [consumers, collectorHealthy]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    const finished = changes.filter(c => c.type === 'position' && !c.dragging && c.position);
    if (finished.length > 0) {
      const saved = loadPositions();
      finished.forEach(c => { saved[c.id] = c.position; });
      savePositions(saved);
    }
  }, [onNodesChange]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <style>{PULSE_KEYFRAMES}</style>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} fitView>
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
