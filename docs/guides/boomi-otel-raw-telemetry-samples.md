# Boomi Runtime — Raw OpenTelemetry Telemetry Samples

**Source:** Boomi Atom Runtime (`SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026`)  
**Account:** `boomi_shah_abdullah-HNCZAC`  
**SDK:** OpenTelemetry Java `1.47.0`  
**Collection Stack:** OTel Fanout Platform → OpenSearch

These samples represent live telemetry emitted by a Boomi Atom runtime and captured via the OpenTelemetry Protocol (OTLP). All three signal types — **Logs**, **Metrics**, and **Traces** — are shown below as stored in OpenSearch.

---

## Signal 1: Log

**Index:** `boomi-logs-2026-07-17`  
**What it represents:** A runtime INFO-level log entry from the Boomi Atom purge manager — a scheduled internal housekeeping operation. This demonstrates the richness of contextual metadata captured alongside each log message.

```json
{
  "timestamp": "2026-07-17T10:40:00.148561Z",
  "ingestion_timestamp": "2026-07-17T10:40:00.548147701Z",
  "observed_timestamp": "2026-07-17T10:40:00.148561Z",
  "severity_number": 9,
  "message": "PURGE: Atom purge all data beginning (1 threads)",
  "source_type": "opentelemetry",
  "data_source": "boomi",
  "dropped_attributes_count": 0,
  "resources": {
    "service.name": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "telemetry.sdk.language": "java",
    "telemetry.sdk.name": "opentelemetry",
    "telemetry.sdk.version": "1.47.0"
  },
  "scope": {
    "name": "8ad9cbe3-a691-434f-a105-e2619dab47df"
  },
  "attributes": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "log.type": "runtime",
    "logger.level": "INFO",
    "logger.name": "com.boomi.purge",
    "source.class": "com.boomi.purge.PurgeManager",
    "source.method": "run",
    "runtime.id": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi",
    "thread.id": 1783
  }
}
```

### Field Reference — Log

| Field | Value | Meaning |
|---|---|---|
| `timestamp` | `2026-07-17T10:40:00.148Z` | When the log event occurred in the Atom |
| `ingestion_timestamp` | `2026-07-17T10:40:00.548Z` | When the OTel platform received it (~400ms latency) |
| `severity_number` | `9` | OTel standard: 5=DEBUG, **9=INFO**, 13=WARN, 17=ERROR |
| `message` | `PURGE: Atom purge all data...` | The log message body |
| `logger.name` | `com.boomi.purge` | Java class that generated the log |
| `source.class` | `com.boomi.purge.PurgeManager` | Specific class within the Boomi runtime |
| `source.method` | `run` | Method that was executing |
| `runtime.name` | `SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026` | Human-readable Atom name |
| `account.id` | `boomi_shah_abdullah-HNCZAC` | Boomi account identifier |
| `thread.id` | `1783` | JVM thread that generated the log |
| `telemetry.sdk.version` | `1.47.0` | OpenTelemetry Java SDK version on the Atom |

---

## Signal 2: Metrics

**Index:** `boomi-metrics-2026-07-17`  
**What it represents:** A snapshot of JVM and execution metrics emitted at a single point in time by the Boomi Atom. Each metric is a separate document. The five samples below were all emitted in the same reporting interval.

### Metric 1 — JVM Heap (Current Usage)

```json
{
  "name": "jvm.heap.current",
  "kind": "absolute",
  "timestamp": "2026-07-17T10:40:10.059726Z",
  "gauge": {
    "value": 69819920.0
  },
  "tags": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "runtime.id": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "resource.service.name": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "resource.telemetry.sdk.language": "java",
    "resource.telemetry.sdk.name": "opentelemetry",
    "resource.telemetry.sdk.version": "1.47.0",
    "source": "Boomi"
  }
}
```

> **Interpreted value:** `69,819,920 bytes` = **~66.6 MB** of heap in use

### Metric 2 — JVM Heap (Maximum Configured)

```json
{
  "name": "jvm.heap.max",
  "kind": "absolute",
  "timestamp": "2026-07-17T10:40:10.059726Z",
  "gauge": {
    "value": 536870912.0
  },
  "tags": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi"
  }
}
```

> **Interpreted value:** `536,870,912 bytes` = **512 MB** max heap — runtime is at **13% heap utilisation**, well within healthy range

### Metric 3 — Running Execution Count

```json
{
  "name": "execution.runningExecutionCount",
  "kind": "absolute",
  "timestamp": "2026-07-17T10:40:10.059726Z",
  "gauge": {
    "value": 0.0
  },
  "tags": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi"
  }
}
```

> **Interpreted value:** `0` — no processes executing at this moment (runtime is idle)

### Metric 4 — GC Time (Young Generation)

```json
{
  "name": "jvm.gc.time",
  "kind": "absolute",
  "timestamp": "2026-07-17T10:40:10.059726Z",
  "gauge": {
    "value": 1502.0
  },
  "tags": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "gc.name": "G1 Young Generation",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi"
  }
}
```

> **Interpreted value:** `1,502 ms` cumulative GC time in the G1 Young Generation collector — normal for a long-running JVM

### Metric 5 — GC Time (Old Generation)

```json
{
  "name": "jvm.gc.time",
  "kind": "absolute",
  "timestamp": "2026-07-17T10:40:10.059726Z",
  "gauge": {
    "value": 0.0
  },
  "tags": {
    "gc.name": "G1 Old Generation",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi"
  }
}
```

> **Interpreted value:** `0 ms` in Old Generation GC — no major GC events have occurred, indicating healthy memory management

### Field Reference — Metrics

| Field | Meaning |
|---|---|
| `name` | The metric identifier (follows OTel semantic conventions) |
| `kind` | `absolute` = current point-in-time gauge value |
| `timestamp` | When the metric was sampled on the Atom |
| `gauge.value` | The numeric measurement — units depend on the metric (bytes for memory, ms for time, count for executions) |
| `tags.gc.name` | GC collector name — G1 Young Generation (frequent, fast) vs G1 Old Generation (infrequent, can cause pauses) |
| `tags.runtime.name` | Human-readable Atom/Molecule name set in Boomi Atom Management |
| `tags.account.id` | Boomi account — useful for multi-account environments |

---

## Signal 3: Trace

**Index:** `ss4o_traces-traces-boomi`  
**What it represents:** A distributed trace span from a Boomi process execution — in this case, the `DH - Provider to Epic` integration process. Each span represents one unit of work within an execution. Multiple spans with the same `traceId` make up the full execution trace.

```json
{
  "name": "Starting process execution.",
  "kind": "Internal",
  "traceId": "00b2843a0c5a588bb8deac5ab3ab7950",
  "spanId": "e0b0f16da8f518fe",
  "parentSpanId": "b9981df91acfa199",
  "startTime": "2026-06-29T16:40:26.748693Z",
  "endTime": "2026-06-29T16:40:30.356216854Z",
  "status": {
    "code": "Ok",
    "message": ""
  },
  "resource": {
    "service.name": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "telemetry.sdk.language": "java",
    "telemetry.sdk.name": "opentelemetry",
    "telemetry.sdk.version": "1.47.0"
  },
  "instrumentationScope": {
    "name": "boomi_shah_abdullah-HNCZAC",
    "version": "",
    "schemaUrl": ""
  },
  "attributes": {
    "account.id": "boomi_shah_abdullah-HNCZAC",
    "process.id": "2a5160d8-1c93-4bf1-9e11-8dcf188647e8",
    "process.name": "DH - Provider to Epic",
    "execution.id": "execution-59576fb0-ace5-41aa-a767-b0b312b48a71-2026.06.29",
    "execution.invocationType": "manual",
    "execution.mode": "general",
    "execution.success": "true",
    "execution.topLevelProcessId": "2a5160d8-1c93-4bf1-9e11-8dcf188647e8",
    "execution.topLevelProcessName": "DH - Provider to Epic",
    "runtime.id": "8ad9cbe3-a691-434f-a105-e2619dab47df",
    "runtime.name": "SHAH_MACOS_LOCAL_DOCKER_RUNTIME_03292026",
    "source": "Boomi",
    "data_stream": {
      "type": "span",
      "dataset": "traces",
      "namespace": "boomi"
    }
  },
  "droppedAttributesCount": 0,
  "droppedEventsCount": 0,
  "droppedLinksCount": 0,
  "traceState": ""
}
```

### Field Reference — Trace

| Field | Value | Meaning |
|---|---|---|
| `name` | `Starting process execution.` | The operation name for this span |
| `kind` | `Internal` | OTel span kind — internal to the Boomi runtime |
| `traceId` | `00b2843a0c5a...` | Unique ID for the full execution — all spans in this execution share this ID |
| `spanId` | `e0b0f16da8f518fe` | Unique ID for this individual span |
| `parentSpanId` | `b9981df91acfa199` | The span that triggered this one — enables the full trace tree to be reconstructed |
| `startTime` | `2026-06-29T16:40:26.748Z` | Process execution started |
| `endTime` | `2026-06-29T16:40:30.356Z` | Process execution completed |
| **Duration** | **~3.6 seconds** | `endTime − startTime` |
| `status.code` | `Ok` | Execution completed successfully |
| `process.name` | `DH - Provider to Epic` | The Boomi integration process that executed |
| `execution.invocationType` | `manual` | Triggered manually (vs scheduled or API-triggered) |
| `execution.success` | `true` | Confirms successful completion |
| `execution.mode` | `general` | Standard execution mode |

---

## Summary: What Each Signal Type Tells You

| Signal | Cadence | Primary Use |
|---|---|---|
| **Logs** | Continuous (event-driven) | Operational health, error investigation, audit trail |
| **Metrics** | Every ~30 seconds (polling) | Performance trending, capacity planning, alerting |
| **Traces** | Per process execution | End-to-end execution visibility, latency analysis, failure diagnosis |

All three signals share common context fields (`account.id`, `runtime.id`, `runtime.name`) enabling correlation across signal types — for example, a spike in `jvm.heap.current` metrics at the same timestamp as an ERROR log can be linked to a specific process execution via its `traceId`.

---

*Telemetry collected by the OTel Fanout Platform — github.com/boomi-internal/otel-fanout-platform*
