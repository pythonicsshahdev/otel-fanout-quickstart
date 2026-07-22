# OTel Fanout Platform

A Docker Compose-based observability pipeline for Boomi runtimes and AI agent workloads. Receives logs, metrics, and traces via OTLP and fans out traces to multiple downstream consumers — managed through a browser-based Control Plane UI.

**GitHub:** https://github.com/pythonicsshahdev/otel-fanout-quickstart  
**Docker Hub:** https://hub.docker.com/u/pythonicshahdev

---

## Architecture

| Component | Ports | Signals | Destination |
|---|---|---|---|
| **Vector** | :4317 (gRPC), :4318 (HTTP) | Logs + Metrics | OpenSearch |
| **OTel Collector** | :4319 (gRPC), :4320 (HTTP) | Traces | OpenSearch + consumer fanout |

Logs and metrics go directly to OpenSearch via Vector. Traces are handled by the OTel Collector, which fans them out to OpenSearch and any enabled consumers.

## What's Included

- **Vector** — high-throughput log and metric ingestion → OpenSearch
- **OTel Collector** — trace ingestion with consumer fanout
- **OpenSearch** — always-on telemetry storage
- **Grafana** — 7 pre-built dashboards (Pipeline Health, Logs, Traces, JVM Health, Process Execution, Runtime Status)
- **Prometheus** — internal pipeline health scraper
- **Control Plane UI** — browser-based consumer management with live pipeline diagram

### Supported Consumers (toggle on/off via UI)

Consumer fanout is applied to **traces**. Logs and metrics are stored locally in OpenSearch.

| Consumer | Notes |
|---|---|
| New Relic | Free tier available (100 GB/month) |
| Datadog | — |
| Dynatrace | OTLP native since v1.222+ |
| Splunk | HEC endpoint |

---

## Quick Start

```bash
docker compose up -d
```

Override credentials via `.env`:

```bash
cp .env.example .env
# edit .env, then:
docker compose up -d
```

---

## Accessing the Stack

| Service | URL | Credentials |
|---|---|---|
| Control Plane | https://localhost:8090 | admin / changeme |
| Grafana | http://localhost:3000 | admin / changeme |
| OpenSearch | http://localhost:9200 | None (security disabled) |

> **Note:** The Control Plane uses a self-signed TLS cert — accept the browser warning on first visit.

## Connecting a Telemetry Source

**Logs + Metrics** — point to Vector:

| Protocol | Endpoint |
|---|---|
| OTLP/gRPC | `http://<host-ip>:4317` |
| OTLP/HTTP | `http://<host-ip>:4318` |

**Traces** — point to OTel Collector:

| Protocol | Endpoint |
|---|---|
| OTLP/gRPC | `http://<host-ip>:4319` |
| OTLP/HTTP | `http://<host-ip>:4320` |

### Boomi Atom example

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4317
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://host.docker.internal:4319
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_LOGS_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_SERVICE_NAME=boomi-runtime
```

---

*Built by Shah Abdullah — shah.abdullah@boomi.com*
