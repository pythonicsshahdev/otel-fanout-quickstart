# OTel Fanout Platform

A Docker Compose-based OpenTelemetry observability pipeline for Boomi runtimes and AI agent workloads. Receives logs, metrics, and traces via OTLP and fans them out to multiple downstream consumers — managed through a browser-based Control Plane UI.

**GitHub:** https://github.com/boomi-internal/otel-fanout-platform  
**Docker Hub:** https://hub.docker.com/u/pythonicshahdev

---

## What's Included

- **OTel Collector** — single OTLP ingestion point for all three signals (logs, metrics, traces)
- **OpenSearch** — always-on telemetry storage
- **Grafana** — 7 pre-built dashboards (Pipeline Health, Logs, Traces, JVM Health, Process Execution, Runtime Status)
- **Prometheus** — internal pipeline health scraper
- **Control Plane UI** — browser-based consumer management with live pipeline diagram

### Supported Consumers (toggle on/off via UI)

| Consumer | Signals | Notes |
|---|---|---|
| OpenSearch | Logs, Metrics, Traces | Always on — local storage |
| New Relic | Logs, Metrics, Traces | Free tier available (100 GB/month) |
| Datadog | Logs, Metrics, Traces | — |
| Dynatrace | Logs, Metrics, Traces | OTLP native since v1.222+ |
| Splunk | Logs, Metrics, Traces | HEC endpoint |
| Prometheus | Metrics only | Remote write |

---

## Option 1: Docker Hub (No Source Code Required)

Pull and run pre-built images directly from Docker Hub. No cloning required.

### Quick Start — docker compose (recommended)

```bash
# Download the hub compose file
curl -O https://raw.githubusercontent.com/boomi-internal/otel-fanout-platform/main/docker-compose.hub.yml

# Start the stack
docker compose -f docker-compose.hub.yml up -d
```

### Quick Start — docker run

Run each service individually using the commands below. Copy and paste the full block into your terminal:

```bash
# 1. Create a shared network and volumes
docker network create boomi-net
docker volume create opensearch-data
docker volume create otel-config
docker volume create prometheus-config
docker volume create prometheus-data
docker volume create grafana-data
docker volume create consumers-data

# 2. OpenSearch (primary storage)
docker run -d \
  --name opensearch \
  --network boomi-net \
  -e discovery.type=single-node \
  -e DISABLE_SECURITY_PLUGIN=true \
  -e "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
  -p 9200:9200 \
  -v opensearch-data:/usr/share/opensearch/data \
  opensearchproject/opensearch:latest

# 3. Wait for OpenSearch to be healthy, then start OTel Collector
sleep 30

docker run -d \
  --name otel-collector \
  --network boomi-net \
  -p 4317:4317 \
  -p 4318:4318 \
  -v otel-config:/etc/otelcol-contrib \
  otel/opentelemetry-collector-contrib:latest \
  --config=/etc/otelcol-contrib/config.yaml

# 4. Control Plane (initialises configs and manages consumers)
docker run -d \
  --name control-plane \
  --network boomi-net \
  -p 8090:8090 \
  -e CONSUMERS_PATH=/data/consumers.json \
  -e TEMPLATE_PATH=/templates/otel-collector-config.hbs \
  -e CONFIG_OUTPUT_PATH=/config/otel-collector-config.yaml \
  -e COLLECTOR_CONTAINER=otel-collector \
  -e DEPLOY_TARGET=compose \
  -v consumers-data:/data \
  -v otel-config:/config \
  -v prometheus-config:/prometheus-config \
  -v /var/run/docker.sock:/var/run/docker.sock \
  pythonicshahdev/otel-fanout-control-plane:latest

# 5. Prometheus (pipeline health scraper)
docker run -d \
  --name prometheus \
  --network boomi-net \
  -v prometheus-config:/etc/prometheus \
  -v prometheus-data:/prometheus \
  prom/prometheus:latest \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.retention.time=7d

# 6. Grafana (dashboards)
docker run -d \
  --name grafana \
  --network boomi-net \
  -p 3000:3000 \
  -e GF_SECURITY_ADMIN_USER=admin \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -v grafana-data:/var/lib/grafana \
  pythonicshahdev/otel-fanout-grafana:latest
```

---

## Option 2: From Source (Internal / Development)

Clone the repository and build locally. Use this when you want to modify the source code or contribute.

```bash
git clone https://github.com/boomi-internal/otel-fanout-platform.git
cd otel-fanout-platform
docker compose up -d
```

---

## Accessing the Stack

| Service | URL | Credentials |
|---|---|---|
| Control Plane | http://localhost:8090 | None |
| Grafana | http://localhost:3000 | admin / admin |
| OpenSearch | http://localhost:9200 | None (security disabled) |

## Connecting a Telemetry Source

Point any OTLP-compatible source at:

| Protocol | Endpoint |
|---|---|
| OTLP/gRPC | `http://<host-ip>:4317` |
| OTLP/HTTP | `http://<host-ip>:4318` |

## Docker Hub Images

| Image | Tags | Description |
|---|---|---|
| `pythonicshahdev/otel-fanout-control-plane` | `latest`, `boomi`, `2026-07-18` | Control Plane UI (React + Node.js) |
| `pythonicshahdev/otel-fanout-grafana` | `latest`, `2026-07-18` | Grafana with OpenSearch plugin + 7 dashboards |

---

*Built by Shah Abdullah — shah.abdullah@boomi.com*
