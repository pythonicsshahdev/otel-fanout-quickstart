# OTel Fanout Platform — Technical Setup Guide

*Full Technical Guide*  
**Prepared by:** Shah Abdullah  
**Contact:** shah.abdullah@boomi.com  
**Target Audience:** Boomi Administrators, Platform Engineers, and IT Operations teams responsible for deploying and managing observability infrastructure

---

## Architecture Overview

The OTel Fanout Platform is a Docker Compose-based observability pipeline that receives telemetry from any OTLP-compatible source and fans it out to one or more downstream consumers — all managed through a browser-based Control Plane UI.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TELEMETRY SOURCES                            │
│                                                                     │
│   Boomi Atom / Molecule    Boomi Agent Studio    Copilot Agents     │
│           │                       │                    │            │
│           └───────────────────────┴────────────────────┘            │
│                               OTLP                                  │
│                          :4317 / :4318                              │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                       OTel Collector                              │
│                                                                   │
│   • Receives all signals (logs, metrics, traces)                  │
│   • Batches and routes to all enabled consumers                   │
│   • Exposes pipeline health metrics on :8888                      │
└────┬──────────────┬──────────────┬──────────────┬────────────────┘
     │              │              │              │
     ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐
│OpenSearch│  │New Relic │  │ Datadog  │  │  Dynatrace │  ...
│(always) │  │(toggle)  │  │(toggle)  │  │  (toggle)  │
└────┬────┘  └──────────┘  └──────────┘  └────────────┘
     │
     ├──────────────────────┐
     ▼                      ▼
┌──────────┐         ┌────────────┐
│ Grafana  │◄────────│ Prometheus │
│  :3000   │         │  (scraper) │
│7 dashbds │         │            │
└──────────┘         └─────┬──────┘
                           │
                    scrapes :8888

┌───────────────────────────────────────┐
│         Control Plane  :8090          │
│                                       │
│  • Toggle consumers on/off            │
│  • Enter and store credentials        │
│  • Live pipeline diagram              │
│  • Triggers OTel Collector restart    │
└───────────────────────────────────────┘
```

> 📷 **SCREENSHOT:** Architectural diagram (see Gemini-generated diagram)

### Key Design Principles

| Principle | Detail |
|---|---|
| **Single ingestion point** | All OTLP sources send to one endpoint. No per-consumer SDK changes required. |
| **Fan-out at the collector** | OTel Collector handles all signal routing. Adding a consumer is a config change, not a code change. |
| **OpenSearch always on** | All telemetry is always stored in OpenSearch. Consumers are additive — disabling one does not affect others. |
| **Config-driven** | `consumers.json` is the single source of truth. It is ConfigMap-portable for future Kubernetes deployments. |
| **No agent installation** | Sources only need OTLP configured. No Boomi-specific SDK or agent is required on the source side. |

### Container Summary

| Container | Image | Port | Role |
|---|---|---|---|
| `otel-collector` | `otel/opentelemetry-collector-contrib` | 4317, 4318 | OTLP ingestion and fan-out hub |
| `opensearch` | `opensearchproject/opensearch` | 9200 | Primary telemetry storage |
| `prometheus` | `prom/prometheus` | — | Scrapes collector pipeline metrics |
| `grafana` | Custom (plugin pre-installed) | 3000 | Dashboards and visualisation |
| `control-plane` | Custom (React + Node.js) | 8090 | Consumer management UI |

---

## 1. Prerequisites

Before beginning, ensure the following are available:

- **Docker Desktop** (or Docker Engine + Docker Compose plugin) installed and running on the host machine
- **Ports available** on the host: `4317`, `4318` (OTLP), `3000` (Grafana), `8090` (Control Plane), `9200` (OpenSearch)
- **Git** installed to clone the repository
- **Boomi Atom or Molecule** configured to emit OpenTelemetry telemetry (logs, metrics, and traces via OTLP)
- At least **4GB RAM** available for the Docker stack
- An account with any downstream consumer you intend to enable (e.g., New Relic free account)

> **ℹ️ Note:** The stack runs entirely on Docker Compose and requires no Kubernetes or cloud infrastructure for the base deployment.

---

## 2. Deploy the Stack

### Part A: Clone the Repository

1. Open a terminal and clone the repository:

```bash
git clone https://github.com/boomi-internal/otel-fanout-platform.git
cd otel-fanout-platform
```

2. Verify the directory structure contains the following key files:

```
otel-fanout-platform/
├── docker-compose.yml
├── otel-collector-config.yaml
├── otel-collector-config.hbs
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   ├── Dockerfile
│   ├── provisioning/
│   └── dashboards/
└── control-plane/
```

### Part B: Start the Stack

1. From the project root, run:

```bash
docker compose up -d
```

2. Wait approximately 60 seconds for all services to initialise. Then verify all containers are running:

```bash
docker compose ps
```

3. Confirm the following containers show **Up** status:

| Container | Port | Purpose |
|---|---|---|
| `opensearch` | 9200 | Telemetry storage |
| `otel-collector` | 4317, 4318 | OTLP ingestion and fan-out |
| `prometheus` | — (internal) | Pipeline metrics scraper |
| `grafana` | 3000 | Dashboards and visualisation |
| `control-plane` | 8090 | Consumer management UI |

> 📷 **SCREENSHOT:** Terminal output of `docker compose ps` showing all 5 containers with Up status

### Part C: Verify the Stack is Healthy

1. Open a browser and navigate to `http://localhost:8090`

2. The Control Plane UI should load and display the pipeline diagram. The **OTel Collector** node should have a **green border**, confirming it is reachable and healthy

> 📷 **SCREENSHOT:** Control Plane UI at localhost:8090 showing green OTel Collector node

> **ℹ️ Note:** If the OTel Collector node shows a red border, check container logs with `docker logs otel-collector --tail 30`

---

## 3. Connect Your Telemetry Source

The OTel Fanout Platform accepts any **OTLP-compatible** telemetry source. All three signal types — logs, metrics, and traces — are received on the same ports.

| Protocol | Host | Port | Use |
|---|---|---|---|
| OTLP/gRPC | `<host-ip>` | `4317` | Preferred for high-volume |
| OTLP/HTTP | `<host-ip>` | `4318` | Use if gRPC is unavailable |

### Part A: Configure Boomi Atom for OTLP

1. Log in to **Boomi Enterprise Platform** at `platform.boomi.com`

2. Navigate to **Manage → Atom Management** and select your Atom or Molecule

3. Under **Properties**, locate the **OpenTelemetry** configuration section

4. Set the following values:

| Field | Value |
|---|---|
| OTLP Endpoint | `http://<host-ip>:4317` |
| Protocol | `grpc` |
| Enabled | `true` |

> 📷 **SCREENSHOT:** Boomi Atom Management screen showing OTLP endpoint configuration

5. Restart the Atom to apply the configuration

6. After restart, return to the Control Plane at `http://localhost:8090` — the **Boomi Atom** node should begin pulsating blue, confirming telemetry is flowing

> 📷 **SCREENSHOT:** Control Plane pipeline diagram showing pulsating Boomi Atom node

### Part B: Other OTLP Sources

Any application instrumented with the OpenTelemetry SDK can send telemetry to the same endpoints. Point the OTLP exporter in your application to:

```
http://<host-ip>:4317   # gRPC
http://<host-ip>:4318   # HTTP
```

Examples: LangChain agents, Copilot agents, Boomi Agent Studio, FastAPI applications, Spring Boot services.

---

## 4. Control Plane

The Control Plane is the management interface for the platform. It runs at `http://localhost:8090` and allows you to toggle downstream consumers, manage credentials, and monitor pipeline health in real time.

### Part A: Access the Control Plane

1. Open a browser and navigate to `http://localhost:8090`

2. The interface is divided into two panels:
   - **Left panel** — Consumer toggle cards
   - **Right panel** — Live pipeline diagram

> 📷 **SCREENSHOT:** Full Control Plane UI showing left panel with consumer cards and right panel with pipeline diagram

### Part B: Enable a Consumer (New Relic Walkthrough)

The following steps demonstrate enabling New Relic as a downstream consumer. The same pattern applies to all other consumers.

1. In the left panel, locate the **New Relic** card

> 📷 **SCREENSHOT:** New Relic consumer card in disabled state

2. Click the **toggle** to enable New Relic. The credential fields will expand

> 📷 **SCREENSHOT:** New Relic card expanded showing License Key field

3. Fill in the following field:

| Field | Value |
|---|---|
| License Key | Your New Relic Ingest License Key (ends in `NRAL`) |

> **ℹ️ Note:** To obtain a license key, log in to **one.newrelic.com → API Keys → Create a key → Type: Ingest - License**

4. Click **Save & Apply**

5. The platform will:
   - Write the updated configuration
   - Render a new OTel Collector config from the template
   - Restart the OTel Collector (~5 seconds)
   - Return a success confirmation

> 📷 **SCREENSHOT:** Success message after Save & Apply

6. The pipeline diagram will update to show **New Relic** as a connected consumer node with a pulsating green indicator

> 📷 **SCREENSHOT:** Pipeline diagram showing New Relic node connected with green pulse

7. In New Relic, navigate to **one.newrelic.com → Logs** to confirm telemetry is arriving within 1–2 minutes

> 📷 **SCREENSHOT:** New Relic Logs UI showing Boomi log entries

### Part C: Understanding the Pipeline Diagram

The pipeline diagram provides a real-time view of the telemetry flow through the platform.

| Element | Meaning |
|---|---|
| **Boomi Atom** node pulsing blue | Source is connected and sending telemetry |
| **OTel Collector** node green border + pulse | Collector is healthy and processing data |
| **OTel Collector** node red border | Collector is unreachable or in error state |
| **Consumer** node pulsing green | Consumer is enabled and receiving data |
| **Dashed animated edge** | Data is actively flowing along this path |
| **Static edge** | Connection defined but collector not healthy |

> **ℹ️ Note:** Nodes are **draggable** — click and drag any node to reposition it. The layout is saved in your browser and persists across page refreshes.

> 📷 **SCREENSHOT:** Annotated pipeline diagram with callouts for each element type

---

## 5. Grafana Dashboards

Grafana provides seven pre-built dashboards covering pipeline health, runtime telemetry, and Boomi-specific operational metrics. All dashboards are provisioned automatically when the stack starts.

### Part A: Accessing Grafana

1. Open a browser and navigate to `http://localhost:3000`

2. Log in with:

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin` |

3. From the home screen, click **Dashboards** in the left sidebar to see all seven pre-built dashboards

> 📷 **SCREENSHOT:** Grafana dashboard list showing all 7 dashboards

> **ℹ️ Note:** All dashboards default to a **Last 1 hour** time range. If your Atom has been running for longer, extend the range to **Last 7 days** using the time picker in the top-right corner to see historical data.

---

### Part B: Pipeline Health

**Question this dashboard answers:** *Is my OTel Collector working, and is data reaching my consumers?*

Navigate to **Dashboards → Pipeline Health**

> 📷 **SCREENSHOT:** Pipeline Health dashboard overview

This dashboard queries the OTel Collector's internal Prometheus metrics and shows:

| Panel | What it tells you |
|---|---|
| **Logs / Metric Points / Spans Received** | Total signals ingested since collector start |
| **Export Errors** | Count of failed export attempts — should be 0 |
| **Ingestion Rate** | Real-time throughput per signal type (logs/s, metrics/s, spans/s) |
| **Export Rate by Exporter** | How much data is reaching each consumer |
| **Export Failures by Exporter** | Which consumer is failing and at what rate |
| **Exporter Queue Size** | Data buffered in the sending queue — spikes indicate a slow or unreachable consumer |

> **ℹ️ Note:** A sustained non-zero **Export Errors** or growing **Queue Size** for a specific exporter indicates that consumer's endpoint or credentials need attention. Check the consumer's card in the Control Plane and verify credentials.

---

### Part C: Logs Overview

**Question this dashboard answers:** *What is my Boomi runtime logging, and are there errors I should know about?*

Navigate to **Dashboards → Logs Overview**

> 📷 **SCREENSHOT:** Logs Overview dashboard showing severity breakdown and log stream

This dashboard queries the `boomi-logs-*` OpenSearch indices and shows:

| Panel | What it tells you |
|---|---|
| **Total Logs / Errors / Warnings / Info** | Counts for the selected time range — use as a quick health check |
| **Log Volume by Severity** | Time series showing ERROR (red), WARN (orange), INFO (blue), DEBUG (grey) — spikes in ERROR indicate runtime issues |
| **Severity Distribution** | Pie chart — a healthy runtime will be predominantly DEBUG/INFO |
| **Top Sources** | Which service names are generating the most log volume |
| **Log Stream** | Live scrollable log entries with full message detail |

> **ℹ️ Note:** OTel severity numbers map as follows: **5** = DEBUG, **9** = INFO, **13** = WARN, **17** = ERROR. These are visible in the raw log entries in the Log Stream panel.

---

### Part D: Traces Overview

**Question this dashboard answers:** *Which Boomi processes are executing, and are any failing?*

Navigate to **Dashboards → Traces Overview**

> 📷 **SCREENSHOT:** Traces Overview dashboard showing top processes bar chart

This dashboard queries the `ss4o_traces-traces-*` OpenSearch indices and shows:

| Panel | What it tells you |
|---|---|
| **Total Spans** | Total process executions captured in the time range |
| **Error Spans** | Executions that completed with an error status |
| **Unique Processes** | Number of distinct Boomi processes that have executed |
| **Avg Span Duration** | Mean execution time across all processes |
| **Span Rate Over Time** | Execution throughput — dips may indicate the Atom is idle or down |
| **Top Processes by Span Count** | Bar chart of your most frequently executed processes |
| **Span Status Distribution** | Donut chart — proportion of Ok vs Error status |
| **Recent Spans** | Table of span names and counts for the selected period |

> **ℹ️ Note:** Extend the time range to **Last 6 hours** or **Last 24 hours** to see a meaningful process execution history, as individual process runs may be infrequent.

---

### Part E: JVM Health

**Question this dashboard answers:** *How is my Boomi runtime's Java memory and garbage collection performing?*

Navigate to **Dashboards → JVM Health**

> 📷 **SCREENSHOT:** JVM Health dashboard showing heap usage time series

This dashboard queries the `boomi-metrics-*` OpenSearch indices and shows:

| Panel | What it tells you |
|---|---|
| **Heap Used** | Current JVM heap memory in use — watch for sustained high values |
| **Heap Max** | Maximum heap configured — the ceiling your runtime cannot exceed |
| **Non-Heap Used** | Metaspace and code cache memory — typically stable |
| **Active Threads** | Number of live JVM threads |
| **Heap Usage Over Time** | Heap current (solid) vs Heap max (dashed red) — gap between lines is your headroom |
| **GC Activity** | Garbage collection count and time — frequent GC with long pauses indicates memory pressure |
| **Threads & CPU** | Active threads and CPU time over the period |
| **Heap Usage by Runtime** | Per-runtime heap breakdown — useful when monitoring multiple Atoms |

> **ℹ️ Note:** If **Heap Used** is consistently above 80% of **Heap Max**, consider increasing the Atom's JVM heap allocation in Boomi Atom Management or reviewing process memory usage.

---

### Part F: Process Execution

**Question this dashboard answers:** *Are executions queuing up or completing normally? Is the runtime keeping up with demand?*

Navigate to **Dashboards → Process Execution**

> 📷 **SCREENSHOT:** Process Execution dashboard showing running vs queued chart

This dashboard queries the `boomi-metrics-*` OpenSearch indices and shows:

| Panel | What it tells you |
|---|---|
| **Running Executions** | Processes actively executing right now |
| **Queued Executions** | Processes waiting to run — a non-zero sustained value means the runtime is at capacity |
| **Avg Execution Time** | Mean time per process execution in milliseconds |
| **Avg Queue Wait Time** | How long processes wait before starting — high values indicate throughput constraints |
| **Running vs Queued vs Capacity** | Time series comparing actual load to the configured maximum — the dashed red line is the ceiling |
| **Execution Times** | Avg execution time and avg queue wait time together — helps identify whether slowness is in execution or the queue |
| **Local Execution Count by Runtime** | Which runtimes are processing the most work |
| **Top Boomi Processes** | Bar chart of most frequently executed processes by span count |

> **ℹ️ Note:** If **Queued Executions** is consistently non-zero and **Avg Queue Wait Time** is growing, the runtime may need additional worker threads or a Molecule with more nodes.

---

### Part G: Runtime Status

**Question this dashboard answers:** *Is my Boomi runtime healthy, and is it communicating with the platform correctly?*

Navigate to **Dashboards → Runtime Status**

> 📷 **SCREENSHOT:** Runtime Status dashboard showing health flag stat panels

This dashboard queries the `boomi-metrics-*` OpenSearch indices and shows:

| Panel | What it tells you |
|---|---|
| **Low Memory Mode** | Green = Normal / Red = LOW MEMORY — runtime is operating under memory constraints |
| **Out of Memory Error** | Green = OK / Red = OOM ERROR — a critical condition requiring immediate attention |
| **Restarting** | Green = Running / Orange = RESTARTING — runtime is in the process of restarting |
| **Scheduled Processes** | Number of processes with active schedules on this runtime |
| **Platform Messaging — Upload** | Messages delivered, failed, and pending to Boomi platform — failures indicate connectivity issues |
| **Platform Messaging — Download** | Messages received from Boomi platform — failures indicate the runtime cannot receive updates |
| **Queue Server Memory & Disk** | Queue server resource usage vs configured limits — watch for values approaching the dashed red ceiling |
| **Queue Server Count & Threads** | Number of active queues and thread pool usage |

> **ℹ️ Note:** Any **red** indicator on the health flag panels (Low Memory, OOM, Restarting) should be investigated immediately. These conditions can cause process execution failures and runtime instability.

---

## 6. New Relic — Free Tier Integration

New Relic offers a **permanently free tier** with 100 GB of data ingest per month — no credit card required, no time limit. It is the recommended consumer for teams that want a cloud-hosted observability platform alongside OpenSearch without any upfront cost.

### Why New Relic with the OTel Fanout Platform

| Capability | Detail |
|---|---|
| **Free forever** | 100 GB/month ingest, 1 user included, no expiry |
| **No credit card** | Sign up with an email address only |
| **OTLP native** | Accepts logs, metrics, and traces directly — no agent or additional config required |
| **All three signals** | Logs, metrics, and traces are all visible in the New Relic UI immediately after enabling |
| **AI-powered** | New Relic AI can query and explain your telemetry in natural language |

### Part A: Create a Free New Relic Account

1. Navigate to `https://newrelic.com` and click **Sign up free**

2. Enter your email address and create a password — no credit card required

> 📷 **SCREENSHOT:** New Relic sign-up page

3. Select **US** as your data region (unless you are based in the EU — if your account URL is `one.eu.newrelic.com`, you are on the EU region and must use a different endpoint in Part C)

4. Complete the onboarding — when prompted to select an integration or install an agent, click **Skip** or **I'll do this later**. Your stack is already configured to send data via OTLP — no agent installation is needed

> 📷 **SCREENSHOT:** New Relic onboarding screen showing Skip option

### Part B: Generate a License Key

1. Log in to `one.newrelic.com`

2. Click your account name in the top-right corner and select **API keys**

> 📷 **SCREENSHOT:** New Relic API keys menu

3. Click **Create a key** and set the following:

| Field | Value |
|---|---|
| Key type | `Ingest - License` |
| Name | e.g., `OTel Fanout Platform` |

4. Click **Create a key** and copy the generated key — it will end in `NRAL`

> 📷 **SCREENSHOT:** New Relic API key creation dialog showing Ingest - License type selected

> **ℹ️ Note:** Store this key securely. You will not be able to view it again after leaving this screen, though you can always create a new one.

### Part C: Enable New Relic in the Control Plane

1. Open the Control Plane at `http://localhost:8090`

2. Locate the **New Relic** card in the left panel and toggle it **on**

> 📷 **SCREENSHOT:** New Relic consumer card toggled on with license key field visible

3. Paste your license key into the **License Key** field

4. Click **Save & Apply** and wait ~10 seconds for the collector to restart

> 📷 **SCREENSHOT:** Control Plane showing New Relic node connected in pipeline diagram with green pulse

### Part D: Verify Data in New Relic

Allow 1–2 minutes for the first data to arrive after enabling. Then navigate to:

**Logs:**
1. In New Relic, go to **Logs** in the left sidebar
2. You should see Boomi runtime log entries with full attribute context — runtime name, logger class, thread ID, severity

> 📷 **SCREENSHOT:** New Relic Logs UI showing Boomi log entries with attributes panel expanded

**Metrics:**
1. Go to **Query your data** (top navigation)
2. Run the following NRQL query:

```sql
SELECT * FROM Metric WHERE instrumentation.provider = 'opentelemetry' SINCE 30 minutes ago LIMIT 10
```

> 📷 **SCREENSHOT:** New Relic Query Builder showing Boomi JVM metrics results

3. To view JVM heap over time:

```sql
SELECT average(jvm.heap.current) FROM Metric WHERE runtime.name IS NOT NULL TIMESERIES SINCE 1 hour ago
```

**Traces:**
1. Go to **APM & Services** or **Distributed Tracing** in the left sidebar
2. Boomi process executions will appear as services — each process execution is a trace with one or more spans

> 📷 **SCREENSHOT:** New Relic Distributed Tracing showing Boomi process spans

> **ℹ️ Note (EU accounts):** If your New Relic account URL is `one.eu.newrelic.com`, the OTLP endpoint must be changed. Contact your administrator to update the endpoint in the OTel Collector configuration to `https://otlp.eu01.nr-data.net:4317`.

---

## 8. Add a New Consumer

The platform supports the following downstream consumers out of the box. All are configured through the Control Plane UI at `http://localhost:8090`.

| Consumer | Signal Types | Credentials Required |
|---|---|---|
| **OpenSearch** | Logs, Metrics, Traces | Endpoint (always on) |
| **New Relic** | Logs, Metrics, Traces | License Key |
| **Splunk** | Logs, Metrics, Traces | HEC Endpoint, HEC Token |
| **Datadog** | Logs, Metrics, Traces | API Key, Site |
| **Dynatrace** | Logs, Metrics, Traces | OTLP Endpoint, API Token |
| **Prometheus** | Metrics only | Remote Write Endpoint |

### Steps to Enable Any Consumer

1. Navigate to `http://localhost:8090`

2. Locate the consumer card in the left panel and toggle it **on**

3. Fill in the required credential fields for that consumer type (see table above)

4. Click **Save & Apply**

5. Wait 5–10 seconds for the OTel Collector to restart with the new configuration

6. Verify the consumer node appears in the pipeline diagram with a green pulse

7. Log in to the consumer platform and confirm data is arriving

> **ℹ️ Note:** Credentials are stored in `consumers.json` on a persisted Docker volume. They survive container restarts and stack updates without requiring re-entry.

> **ℹ️ Note (Prometheus):** Prometheus is a metrics-only consumer. Logs and traces will continue to route to OpenSearch and any other enabled consumers. Use this option if your organisation runs an existing Prometheus/Thanos stack that you want to receive Boomi runtime metrics.

---

## 9. Troubleshooting

### Collector shows red in the Control Plane

The Control Plane cannot reach the OTel Collector's health endpoint. Check:

```bash
docker logs otel-collector --tail 30
docker compose ps otel-collector
```

If the container is in a `Restarting` state, the configuration file may have an error. Restore the backup:

```bash
# The backup is written automatically before each config change
docker exec control-plane cat /config/otel-collector-config.yaml.bak
```

---

### No data appearing in Grafana

1. Confirm the time range is set appropriately — extend to **Last 7 days** if the stack was recently started
2. Verify the Boomi Atom is configured to send OTLP to `:4317` or `:4318` and has been restarted
3. Check the **Pipeline Health** dashboard — if ingestion rates are zero, the source is not sending data
4. Run a quick connectivity check:

```bash
curl http://localhost:9200/boomi-logs-*/_count
```

If the count is 0 after several minutes of the Atom running, the Atom's OTLP configuration is not pointing to the correct host/port.

---

### A consumer is enabled but receiving no data

1. Open the **Pipeline Health** dashboard in Grafana
2. Check **Export Failures by Exporter** — a non-zero value confirms delivery is failing
3. Check **Exporter Queue Size** — a growing queue confirms data is being received but not delivered
4. Common causes:
   - Wrong API key or token — return to the Control Plane, correct the credential, and Save & Apply
   - Wrong region endpoint — Dynatrace and New Relic have separate EU endpoints
   - Consumer account not provisioned for OTLP — verify the feature is enabled in the consumer's account settings

Check the OTel Collector logs for specific error messages:

```bash
docker logs otel-collector --tail 50 | grep -i error
```

---

### Grafana shows "Index not found" warning on datasources

This is a known cosmetic issue with the OpenSearch datasource plugin's health check when using wildcard index patterns (e.g., `boomi-logs-*`). Dashboard queries work correctly despite this warning. No action is required.

---

*Guide version: 1.0 | Stack version: otel-fanout-platform @ main | Last updated: 2026-07-18*
