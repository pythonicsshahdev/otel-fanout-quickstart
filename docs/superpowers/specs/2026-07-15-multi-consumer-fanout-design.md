# Multi-Consumer Fan-Out + Control Plane Design

**Date:** 2026-07-15  
**Project:** Boomi Observability Stack (vector_simplified)  
**Status:** Approved

---

## Problem Statement

The current stack routes Boomi telemetry to OpenSearch only. There is no mechanism to fan out to other consumers (Splunk, New Relic, Datadog, etc.) without manually editing config files. The architecture must support a plug-in/toggle model where consumers are enabled per deployment, credentials persist across restarts, and the system works both on Docker Compose (on-prem) and Red Hat OpenShift (Boomi Elastic Runtime POC).

---

## Architecture

```
Boomi Atom
    │
    ├─ logs/metrics (OTLP) ──► Vector :4317/:4318
    │                              │ VRL transform
    │                              │ OTLP forward (internal :4321)
    │                              ▼
    └─ traces (OTLP) ──────► OTel Collector :4319/:4320
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
               OpenSearch      Splunk        New Relic
               (always on)    (toggle)       (toggle)
                    │
               Grafana :3000
               OpenSearch Dashboards :5601

Control Plane UI :8080 (React + Vite, served by nginx)
    ├── consumers.json (persisted volume)
    ├── renders otel-collector-config.yaml from template
    └── restarts otel-collector via Docker socket
```

---

## Components

### Vector
- Role: OTLP receiver and preprocessor for logs and metrics only (traces bypassed — Vector does not handle traces reliably)
- Transforms: adds `data_source`, `ingestion_timestamp`, flattens attributes via VRL
- Output: forwards all signals to OTel Collector via OTLP on internal port `:4321` (not exposed to host)
- No longer writes directly to OpenSearch

### OTel Collector
- Role: single fan-out hub for all three signals (logs, metrics, traces)
- Receives: logs/metrics from Vector (OTLP `:4321`), traces from Boomi directly (OTLP `:4319/:4320`)
- Config: generated from a Handlebars template + `consumers.json` at startup and on every consumer change
- Always exports to OpenSearch; other exporters are conditional on enabled state in `consumers.json`
- Exposes `/metrics` (Prometheus) for health and exporter status

### Control Plane UI
- React + Vite frontend served by nginx
- **Left panel:** consumer toggle cards — enable/disable switch, credential fields per consumer type
- **Right panel:** ReactFlow pipeline diagram showing Boomi → Vector → OTel Collector → [consumers] with live status indicators (green/red per exporter)
- **Backend:** Node.js/Express API responsible for:
  - Reading and writing `consumers.json`
  - Rendering `otel-collector-config.yaml` from template
  - Restarting the OTel Collector container via Docker socket
  - Polling collector `/metrics` to report consumer health back to the UI
- Deployed as its own container in the compose stack

### consumers.json
- Persisted source of truth for consumer configuration
- Stored on a named Docker volume, mounted into the control plane backend container
- Schema is ConfigMap-portable for the OpenShift deployment

```json
{
  "consumers": {
    "opensearch": { "enabled": true, "endpoint": "http://opensearch:9200" },
    "splunk": { "enabled": false, "endpoint": "", "token": "" },
    "newrelic": { "enabled": false, "license_key": "" },
    "datadog": { "enabled": false, "api_key": "", "site": "datadoghq.com" },
    "dynatrace": { "enabled": false, "endpoint": "", "api_token": "" },
    "prometheus": { "enabled": false, "endpoint": "http://prometheus:9090/api/v1/write" }
  }
}
```

---

## Data Flow

### Ingestion Path
1. Boomi Atom sends OTLP logs/metrics → Vector `:4317/:4318`
2. Vector applies VRL transforms → re-exports via OTLP to OTel Collector internal `:4321`
3. Boomi Atom sends OTLP traces → OTel Collector `:4319/:4320`
4. OTel Collector batches all signals → exports to every enabled consumer

### Config Change Path
1. User toggles consumer or updates credentials in UI
2. React frontend POSTs to Node.js backend `/api/consumers`
3. Backend backs up current config as `otel-collector-config.yaml.bak`
4. Backend writes updated `consumers.json` to persisted volume
5. Backend renders new `otel-collector-config.yaml` from template
6. Backend writes rendered YAML to OTel Collector config volume
7. Backend calls `docker restart otel-collector` via Docker socket
8. UI polls `/api/status` until collector reports healthy (~3s)
9. Pipeline diagram updates to reflect new consumer state

---

## Error Handling

### Collector Restart Failure
- If collector fails health check within 30s after restart, backend automatically restores `otel-collector-config.yaml.bak`
- UI shows error state on the affected consumer card and surfaces collector logs

### Consumer Unreachable
- Each exporter in the OTel Collector config has `retry_on_failure` and `sending_queue` enabled
- Transient outages queue data locally; no data dropped on brief network interruptions
- Pipeline diagram reflects exporter health via collector `/metrics` endpoint (red indicator = export errors)

### Vector → OTel Collector Forward Failure
- Vector has `retry_on_failure` enabled on the OTLP exporter
- OTel Collector restarting (~3s) is handled by Vector's retry logic without data loss

---

## OpenShift Portability

The design is intentionally portable to the Red Hat OpenShift + Boomi Elastic Runtime POC:

| Concern | Docker Compose | OpenShift |
|---|---|---|
| Consumer config | `consumers.json` on named volume | `consumers.json` as ConfigMap |
| OTel Collector config | Generated YAML on named volume | Generated YAML as ConfigMap |
| Collector restart | Docker socket `docker restart` | `oc rollout restart` or OTel Operator reconcile |
| Restart strategy selection | `DEPLOY_TARGET=compose` env var | `DEPLOY_TARGET=openshift` env var |

The control plane backend switches restart strategy based on `DEPLOY_TARGET`. All config schema, templates, and UI code are identical across both targets.

---

## New Containers Added

| Container | Image | Port | Purpose |
|---|---|---|---|
| `control-plane` | Custom (Node.js + nginx) | `8080` | Config UI + restart backend |

Docker socket mounted read/write into `control-plane` for restart capability.

---

## Prometheus Note
Prometheus is included as a **metrics-only toggle consumer** via the OTel Collector `prometheusremotewrite` exporter. No Prometheus container is added to the stack — Grafana can scrape the OTel Collector `/metrics` endpoint directly for pipeline health. Prometheus as a consumer targets customers who already run Prometheus/Thanos on-prem.

---

## Out of Scope
- Authentication/authorization on the control plane UI (dev/POC use)
- Multi-tenant consumer routing (all signals go to all enabled consumers)
- OTel Collector horizontal scaling
- Prometheus container as part of this stack (customers bring their own)
