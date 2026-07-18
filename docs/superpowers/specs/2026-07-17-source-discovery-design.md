# Source Auto-Discovery + Label + Index Routing Design

**Date:** 2026-07-17
**Project:** Boomi Observability Stack (otel-fanout-platform)
**Status:** Approved
**Extends:** `2026-07-15-multi-consumer-fanout-design.md`

---

## Problem Statement

The current stack accepts OTLP telemetry from any source (Boomi Atom, Copilot agents, Boomi Agent Studio, LangChain, etc.) but the control plane has no awareness of what's sending data. All telemetry lands in the same default OpenSearch indices regardless of origin, and the pipeline diagram shows a static "Boomi Atom" node rather than reflecting the real set of connected sources.

Operators need to:
1. See which sources are actively sending telemetry — without pre-configuring them
2. Assign a friendly label and a custom OpenSearch index prefix per source
3. See sources represented in the pipeline diagram alongside consumers

---

## Design Decisions

**Auto-discover, don't gate.** Sources are not registered before they can send. Any OTLP-compatible source that points at the collector self-identifies via `service.name` / `service.namespace` resource attributes and appears in the UI automatically.

**Label + index prefix only.** Clicking a discovered source lets you rename it and assign an index prefix. Per-source consumer routing (e.g. "send Copilot Agent only to Dynatrace") is a natural future extension of the same config schema and is not in scope here.

**OpenSearch as the discovery source.** The backend queries OpenSearch for distinct `service.name` values from recent telemetry. This requires no new collector plumbing — data is already there.

**Transform processor for index routing.** The OTel Collector `transform` processor injects an `elasticsearch.index.prefix` resource attribute per `service.name` based on a lookup table rendered from `sources.json`. The elasticsearch exporter's `logs_dynamic_index` feature uses this attribute to route to source-specific indices. Sources without a custom prefix fall back to the default index.

---

## Architecture

```
OTLP Sources (Boomi Atom, Copilot Agent, Boomi Agent Studio, LangChain, ...)
    │
    └──► OTel Collector :4317/:4318
              │
              ├── transform/source_routing processor
              │     reads rendered lookup table from sources.json
              │     injects elasticsearch.index.prefix per service.name
              │
              ├──► OpenSearch
              │     copilot-agent     → copilot-logs-*, copilot-traces-*
              │     boomi.agent.studio → agent-studio-logs-*, ...
              │     (no prefix set)   → boomi-logs-* (default)
              │
              └──► All other enabled consumers (unchanged, receive all signals)

Control Plane UI :8090
    ├── consumers.json  (existing)
    ├── sources.json    (NEW — same persisted volume as consumers.json)
    └── otel-collector-config.hbs (extended with transform processor)
```

---

## Components

### sources.json

New file on the same named Docker volume as `consumers.json`. Keyed by `service.name` as reported in the OTLP resource attributes.

```json
{
  "sources": {
    "boomi.atom": {
      "label": "Boomi Atom",
      "index_prefix": "boomi",
      "discovered_at": "2026-07-17T12:00:00Z",
      "last_seen": "2026-07-17T20:00:00Z"
    },
    "copilot-agent": {
      "label": "Copilot Agent",
      "index_prefix": "copilot",
      "discovered_at": "2026-07-17T14:00:00Z",
      "last_seen": "2026-07-17T20:00:00Z"
    }
  }
}
```

`index_prefix` is optional. If absent or empty, the source routes to the default index.

### Discovery Mechanism

The backend queries OpenSearch for distinct `service.name` values at UI load and on a 30-second polling interval:

```
GET /boomi-logs-*/_search
{
  "size": 0,
  "aggs": {
    "sources": {
      "terms": { "field": "<resource.service.name field path>", "size": 50 }
    }
  }
}
```

The exact field path depends on how the elasticsearch exporter maps OTLP resource attributes — confirm during implementation by inspecting an existing OpenSearch document.

Any `service.name` not already in `sources.json` is added automatically with no label and no index prefix. `last_seen` is updated on each poll. Sources are never deleted automatically — stale sources can be dismissed by the operator in the UI.

### OTel Collector Config (HBS template extension)

A `transform/source_routing` processor is added, rendered from the sources that have a non-empty `index_prefix`. The processor runs before the batch processor in all three pipelines.

```yaml
{{#if hasSourceRouting}}
processors:
  transform/source_routing:
    log_statements:
      - context: resource
        statements:
          {{#each sourcesWithPrefix}}
          - set(attributes["elasticsearch.index.prefix"], "{{this.index_prefix}}") where attributes["service.name"] == "{{this.name}}"
          {{/each}}
    metric_statements:
      - context: resource
        statements:
          {{#each sourcesWithPrefix}}
          - set(attributes["elasticsearch.index.prefix"], "{{this.index_prefix}}") where attributes["service.name"] == "{{this.name}}"
          {{/each}}
    trace_statements:
      - context: resource
        statements:
          {{#each sourcesWithPrefix}}
          - set(attributes["elasticsearch.index.prefix"], "{{this.index_prefix}}") where attributes["service.name"] == "{{this.name}}"
          {{/each}}
{{/if}}
```

The elasticsearch exporters gain `logs_dynamic_index: { enabled: true }` (and equivalent for metrics/traces) to honour the injected prefix attribute.

The collector is restarted whenever `sources.json` changes and any source has a non-empty `index_prefix` — the same restart flow used for consumer changes today.

### Backend API (new endpoints)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sources` | Returns current `sources.json` merged with latest discovery poll |
| `POST` | `/api/sources/:name` | Update label and/or index_prefix for a source |
| `DELETE` | `/api/sources/:name` | Remove a source entry (does not block future re-discovery) |

Discovery polling runs on a 30s interval inside the backend process. The frontend polls `/api/sources` on the same cadence as `/api/status`.

### Control Plane UI

**Left panel — tabs.** The current single-panel list of consumer cards gains a tab bar: **Consumers** (existing) and **Sources** (new). The Sources tab shows a list of discovered sources with:
- Friendly label (editable inline)
- `service.name` shown in subdued text below the label
- Last seen timestamp
- Index prefix field (editable inline, placeholder: default index)
- Save button per row (triggers API call + collector restart if prefix changed)

**Pipeline diagram.** Three changes:
1. A dynamic **Sources (N)** node replaces the static "Boomi Atom" node on the left side. Hovering expands it to list all discovered `service.name` / label pairs.
2. Nodes are **draggable** — `nodesDraggable` is enabled on the `<ReactFlow>` component and node positions are persisted in `localStorage` so the layout survives page refresh.
3. Active nodes **pulsate** — a CSS keyframe animation (`box-shadow` pulse, green) is applied to nodes that are healthy/active. The OTel Collector node pulses when `collectorHealthy` is true; consumer nodes pulse when their exporter has no send errors. Source nodes pulse when `last_seen` is within the last 60 seconds.

```css
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
}
```

---

## Data Flow

### Source Discovery Flow
1. Backend polls OpenSearch every 30s for distinct `service.name` values
2. New names are appended to `sources.json` with `discovered_at` + `last_seen`
3. Frontend polls `/api/sources` every 30s; Sources tab updates live
4. Operator clicks a source row, sets a label and/or index prefix, clicks Save
5. If index prefix changed: backend re-renders OTel Collector config → restarts collector (same flow as consumer changes)
6. If label only: backend writes `sources.json`, no collector restart needed

### Index Routing Flow
1. Telemetry arrives at OTel Collector from any source
2. `transform/source_routing` processor matches `resource.service.name` against the rendered lookup table
3. Matching sources get `elasticsearch.index.prefix` injected into resource attributes
4. Elasticsearch exporter uses the prefix to determine the target index name
5. Unmatched sources (no prefix configured) fall back to default `logs_index`

---

## Error Handling

**OpenSearch discovery failure.** If the discovery query fails (OpenSearch down, timeout), the backend logs the error and retains the last known `sources.json` state. The Sources tab shows a "Last synced: X minutes ago" indicator when the poll is stale.

**Collector restart on source change.** Uses the existing rollback mechanism from the consumer change flow — config is backed up before write, and automatically restored if the collector fails to come healthy within 30s.

**No index prefix configured.** Sources without a prefix always fall back to the default index. The transform processor only emits statements for sources with a non-empty prefix, so the rendered config is minimal when no overrides are set.

---

## OpenShift Portability

`sources.json` follows the same schema portability contract as `consumers.json` — it maps 1:1 to a Kubernetes ConfigMap. The `DEPLOY_TARGET` env var already switches the restart strategy; no additional changes needed.

---

## Out of Scope

- Per-source consumer routing (e.g. Copilot Agent → Dynatrace only). Natural extension: add a `consumers` override map per source entry in `sources.json` and a source × consumer matrix in the UI.
- Source deactivation / suppression (muting a noisy source)
- Authentication per source (multi-tenant isolation)
- Automatic source retirement (sources inactive for N days)
