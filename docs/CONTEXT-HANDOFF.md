# OTel Fanout Platform — Engineering Context Handoff

**Purpose:** full working context for a fresh Claude session picking up development on this repo.
**Written:** 2026-09-11, from live inspection of the working tree, the running containers, and OpenSearch.
**Repo root:** `/Users/shahabdullahmac/Documents/OTEL/vector_simplified`
**Branch:** `main`, clean. HEAD `c15db34`.
**Owner:** Shah Abdullah (shah.abdullah@boomi.com)

---

## 1. What this is

A Docker Compose observability stack that receives OTLP telemetry from Boomi runtimes (Atoms and Molecules) and AI-agent workloads, stores all three signals in OpenSearch, visualises them in 10 pre-built Grafana dashboards, and fans **traces** out to external consumers (New Relic, Datadog, Dynatrace, Splunk) through a browser-managed Control Plane.

The stack is architecturally vendor-neutral — the Boomi coupling is surface-level (index names `boomi-*`, a `data_source = "boomi"` tag, UI header text, and the dashboards' field names). That matters because there is an active plan to fork a generic variant (§9).

---

## 2. Architecture — the one thing to internalise

**Two ingest paths, split by signal.** This trips up every new reader, and several bugs in §7 come from parts of the codebase that were never updated after the split.

```
                    ┌─ Vector :4317 gRPC / :4318 HTTP ──→ logs    ──→ OpenSearch  boomi-logs
Boomi Atom / OTLP ──┤                                     metrics ──→ OpenSearch  boomi-metrics
                    └─ OTel Collector :4319 / :4320 ────→ traces  ──→ OpenSearch  ss4o_traces-default-namespace
                                                                  └──→ fanout: New Relic / Datadog / Dynatrace / Splunk
```

- **Vector** handles logs + metrics only. It writes straight to OpenSearch via the `elasticsearch` sink. It also exposes its own internal metrics on `:9598` for Prometheus.
- **OTel Collector** handles traces only. It is the *only* component that fans out to external consumers.
- **Consumer fanout is traces-only.** Logs/metrics fanout was attempted and reverted (commit `fa1335a`) — Vector 0.54.0's `opentelemetry` sink produces invalid OTLP over HTTP. The UI copy says "Receives traces" for this reason. Do not re-attempt without first verifying the Vector sink encoding upstream.
- **Prometheus** scrapes `otel-collector:8888` and `vector:9598`. It has no published host port — Grafana reaches it in-network at `http://prometheus:9090`. It exists purely to power the Pipeline Health dashboard.

### Why the split exists

The OTel Collector's `elasticsearch` exporter (v0.151.0) is incompatible with OpenSearch 3.5 — it sends an ES8-only `dynamic_templates` field that OpenSearch rejects. Vector was brought in to carry logs/metrics (commit `09c3820`). Traces stayed on the Collector because the Collector's *`opensearch`* exporter works fine and because fanout needs the Collector's exporter ecosystem.

---

## 3. Services, ports, images

| Service | Image | Host ports | Notes |
|---|---|---|---|
| opensearch | `opensearchproject/opensearch:latest` | 9200, 9600 | `DISABLE_SECURITY_PLUGIN=true`, single-node, `-Xms512m -Xmx512m` |
| vector | `pythonicshahdev/boomi-vector:latest` | 4317, 4318, 9598 | `vector.toml` is **bind-mounted**, overriding the baked-in copy |
| otel-collector | `otel/opentelemetry-collector-contrib:latest` | 4319→4317, 4320→4318 | config bind-mounted read-write (control plane rewrites it) |
| prometheus | `prom/prometheus:latest` | *(none)* | 7d retention |
| grafana | built from `./grafana` | 3000 | published as `pythonicshahdev/otel-fanout-grafana` |
| control-plane | built from `./control-plane` | 8090 (HTTPS) | published as `pythonicshahdev/otel-fanout-control-plane` |

All six use `restart: always`. **This is deliberate and must not be downgraded to `unless-stopped`** — `colima stop` issues an explicit `docker stop`, which flags containers as manually stopped, and `unless-stopped` then refuses to bring them back. Commit `c15db34`.

**Access:** Control Plane `https://localhost:8090` (self-signed cert, basic auth) · Grafana `http://localhost:3000` · OpenSearch `http://localhost:9200` (no auth).
**Credentials** live in `.env` (gitignored) as `GRAFANA_PASSWORD` and `CONTROL_PLANE_PASSWORD`. Read that file directly; `.env.example` ships `changeme` defaults.

### Docker host is Colima, not Docker Desktop

Profile `default`, 16 GiB (raised from 8 GiB on 2026-08-30 after repeated OpenSearch OOM kills). Resize requires a stop, and you **must** pass `--disk` explicitly or it silently reverts to the 100 GiB default:

```bash
colima stop && colima start --cpu 4 --memory 16 --disk 64
```

A `colima stop` also kills unrelated containers on this machine that have no restart policy (`legacy-order-entry`, `eda-mysql`, `notification-mock`, `billing-mock`, `shah-postgres_instance`) — they need starting by hand afterward.

---

## 4. Data model — the fields dashboards actually query

### `boomi-logs*` (Vector → OpenSearch, **no date suffix**)
`trace_id`, `span_id`, `message`, `severity_number`, `timestamp`, `ingestion_timestamp`, `resources.service.name`, `attributes_raw`, `data_source`.

Vector's `logs_transformed` remap JSON-encodes `.attributes` into a flat `.attributes_raw` string and deletes the original. This exists to stop OpenSearch dynamic-mapping conflicts when different log records carry differently-typed attribute keys. Consequence: **log attributes are not queryable as structured fields.** If a future dashboard needs them, that transform is the thing to change — and you'll need an index template to make it safe.

### `boomi-metrics*` (Vector → OpenSearch, **no date suffix**)
Standard Vector metric shape plus `ingestion_timestamp`, `data_source`. Boomi-specific dimensions live under `tags.*`:

- `tags.runtime.name` — molecule name. **Identical across all nodes**, so it cannot distinguish nodes.
- `tags.jvm.id` — per-node IP identifier, e.g. `172_31_1_107`. **Molecule-only; absent on single-Atom installs.**
- `tags.jvm.type` = `"node"` — molecule-only.
- `tags.scope.name` — node IP, same value as `jvm.id`, molecule-only.

### `ss4o_traces-default-namespace` (OTel Collector → OpenSearch)
`traceId`, `spanId`, `parentSpanId`, `name`, `startTime`, `endTime`, `status.code`, and:
- `attributes.process.name`
- `attributes.execution.id` / `.topLevelProcessName` / `.success` / `.errorMessage` / `.invocationType` / `.mode`
- `attributes.processStep.type` / `.userLabel` / `.inboundDocumentCount` / `.outboundDocumentCount` / `.connector.*`

**There is no `durationInNanos`.** Boomi's spans carry only `startTime`/`endTime`, and the `opensearch` exporter does not derive a duration. Six panels queried that field and silently showed nothing until 2026-09-16. Duration now comes from `attributes.duration_ms`, a double synthesised in the Collector by the `transform/boomi_numeric` OTTL processor:

```
set(span.attributes["duration_ms"], (span.end_time_unix_nano - span.start_time_unix_nano) / 1000000.0)
```

The same processor coerces `processStep.inbound/outboundDocumentCount` and `…DocumentSize` from OTLP **strings** to integers — Boomi sends them as `"0"`, which OpenSearch dynamically mapped as `text`, making them unaggregatable.

### Custom business dimensions — the Notify channel

Boomi's instrumentation emits a **fixed** HTTP attribute set and cannot carry custom request headers onto a span. There is also **no `http.response.status_code`** — `status.code` is the OTel span status (Ok/Error), not an HTTP code.

The USF processes work around this by writing ` | key=value | ` pairs into Notify shape messages, which arrive as `attributes.userEvent.message`. The `transform/boomi_usf_fields` OTTL processor promotes eleven of them to real span attributes via `ExtractPatterns`: `consumerId`, `subConsumerId`, `correlationId`, `transactionId`, `txn`, `responseCode`, `httpStatus`, `endPoint`, `scenario`, `divisionNbr`, and `priced` (the last cast to `long` — it is a measure, not a dimension). Historical spans were backfilled on 2026-09-16 by `_update_by_query` with an equivalent Painless script; 3,220 spans matched.

Three things to know before extending this:

- **Values containing `|` cannot be extracted.** The cache key is logged as `key=42|productprice|v1`, so pipe-delimited parsing truncates it. Fields *after* such a value still parse correctly — each field is matched by its own anchored regex, so one unparseable value doesn't cascade.
- **The dimensions live on the Notify span, not the API root span**, because OTTL cannot join across siblings. Per-consumer request counts, response codes and endpoint mix all work directly. Per-consumer *latency* does not — duration lives on the root span. The cheap unlock is a Boomi-side exit Notify logging both `consumerId` and elapsed ms; `1-APIEntryLogger` already records `txnapiStartTime` to compute it from.
- **The source data is dirty.** `divisionNbr` appears as both `42` and `0042`, and one message genuinely reads `divisionNbr=0042 success`. The extraction is faithful; normalisation belongs in the dashboard or upstream.

Both depend on the `boomi-traces-numeric` index template (priority 200, pattern `ss4o_traces-*`), which pins `duration_ms` to `double` and the four count/size fields to `long`. **The template only applies to newly created indices** — the existing index was rebuilt on 2026-09-16 by reindexing through `backup-ss4o-traces-20260916`, with a Painless script that backfilled `duration_ms` for historical spans. If the index is ever dropped and rebuilt, re-check that the template still exists first.

Note the index name: the Collector config says `logs_index: boomi-traces`, but that key is ignored on a traces pipeline — the `opensearch` exporter writes the SS4O convention `ss4o_traces-<dataset>-<namespace>`. Don't "fix" `logs_index`; fix the expectation.

### Live doc counts as of 2026-09-11
`boomi-logs` 945k · `boomi-metrics` 8.46M · `ss4o_traces-default-namespace` 13.2k. There is also a leftover `boomi-metrics-2026-07-20` (86k) from before the naming change, and a stray `test` index.

---

## 5. Grafana

Provisioned from `grafana/provisioning/`, dashboards from `grafana/dashboards/`. Both are **baked into the image** (`grafana/Dockerfile`) so the Docker Hub image works standalone, *and* bind-mounted in compose for local iteration.

### Datasources (`datasources.yml`)
| Name | uid | Index pattern | timeField |
|---|---|---|---|
| OpenSearch Logs | `opensearch-logs` | `boomi-logs*` | `ingestion_timestamp` |
| OpenSearch Metrics | `opensearch-metrics` | `boomi-metrics*` | `timestamp` |
| OpenSearch Traces | `opensearch-traces` | `ss4o_traces-*` | `startTime` |
| OTel Collector | `otel-collector-prom` | Prometheus | — |

**The patterns are `boomi-logs*` with no dash.** Vector writes `boomi-logs`, not `boomi-logs-<date>`. Writing `boomi-logs-*` yields zero results — this is the exact bug still live in two places (§7.1).

The Logs datasource carries a derived field `TraceID` that links `trace_id` to the traces datasource, giving log→trace correlation.

### The 11 dashboards

| Dashboard | uid | Source | Template vars |
|---|---|---|---|
| Pipeline Health | `pipeline-health` | Prometheus | — |
| Logs Overview | `logs-overview` | Logs | `node` |
| Traces Overview | `traces-overview` | Traces | — |
| JVM Health | `jvm-health` | Metrics | `node` |
| Runtime Status | `runtime-status` | Metrics | `node` |
| Molecule Health | `molecule-health` | Metrics | `node` |
| Process Execution | `process-execution` | Traces | — |
| Process Execution Explorer | `process-execution-explorer` | Traces | `process_name` |
| Step-level Breakdown | `step-breakdown` | Traces | `step_type` |
| Error Drill-down | `error-drilldown` | Traces + Logs | `node` |
| API Performance | `api-performance` | Traces | `route` |

### Step-level Breakdown was dead from the day it was written

Fixed 2026-09-16. Three independent bugs, any one of which emptied the whole dashboard:

1. **`attributes.process.name:$process_name` on every panel.** Step spans do not carry `attributes.process.name` — 0 of ~23.4k do. Only 3,859 spans in the index have the field at all, and none of them are steps. Combined with the step filter this returned exactly 0 rows, always. The `process_name` variable was therefore unusable and has been repointed at `attributes.processStep.type.keyword` (now `step_type`).
2. **`attributes.processStep.type:Connector` / `:Map`.** The real values are lowercase single tokens — `connectoraction`, `map`, `notify`, `catcherrors`, `returndocuments`, `documentproperties`, `processcall`, `dataprocess`, `message`. `Connector` matched nothing.
3. **`durationInNanos`** — see §4.

Step spans identify their process only by `attributes.process.id` and `attributes.execution.topLevelProcessId`, both opaque IDs. The readable `topLevelProcessName` lives on the `Execute process` span, and Grafana cannot join across spans, so **filtering step data by process name is not currently possible** — use Process Execution Explorer for that view.

### Atom vs Molecule — why there are two overlapping dashboards

`tags.jvm.id` only exists on Molecule nodes. The obvious solution — one adaptive dashboard using `NOT _exists_:tags.jvm.id` — **does not work**, and this is worth knowing before you rediscover it:

> The Grafana OpenSearch plugin pre-processes Lucene query strings before sending them. `_exists_` / `NOT _exists_` breaks in the plugin and returns "No data", even though the identical `query_string` works perfectly via raw `curl`. Confirmed broken 2026-08-11, tried and reverted twice (`04f3ccd` → `0105611`, `adf8b53` → `6c1efa6`).

**Retested 2026-09-16 — this does not hold on the traces datasource.** Run through Grafana's own `/api/ds/query` (the real plugin path): `_exists_:attributes.processStep.type` → 23,436 docs, `NOT _exists_:attributes.process.name` → 23,750 docs, `attributes.processStep.type:*` → 23,436 docs. All three work. The 2026-08-11 case was `NOT _exists_:tags.jvm.id` on the **metrics** datasource and has not been retested — it may have been a different failure entirely, or `tags.jvm.id` may simply have been absent from every doc. Do not treat this as a general law; verify field presence first.

So instead: **Molecule Health** (`molecule-health`) is the molecule dashboard — it uses `tags.jvm.id:$node` in every query and a `tags.jvm.id.keyword` terms bucket on every time series, combining JVM Health + Runtime Status into one node-filtered view. **JVM Health** and **Runtime Status** are the single-Atom versions, each carrying a banner text panel pointing molecule users to Molecule Health; their `node` variable is present but decorative.

Driven by a real user — Frank, running a multi-node molecule on EC2.

### Grafana OpenSearch plugin gotchas (all confirmed the hard way)

- **`top_hits` metric type is not supported** — silently returns no data. Use nested `terms` bucket aggregations instead.
- **Terms bucket columns carry a `.keyword` suffix in Grafana.** `byName` field overrides must target `traceId.keyword`, `attributes.execution.topLevelProcessName.keyword` — not the bare name.
- **Data links to a `.keyword` column need bracket syntax**: `${__data.fields["traceId.keyword"]}`, not dot access.
- **`success.keyword` as a nested terms bucket duplicates rows** (one `true` + one `false` per trace). Don't bucket on it; use the Error Drill-down dashboard for failure status.
- Set `min_doc_count: "1"` on every nested terms bucket to suppress zero-count rows.
- `execution.config.maxRunningExecutions` is `Integer.MAX_VALUE` (2147483647) when uncapped — it was removed from Process Execution because it blows out the Y axis.
- For readable execution tables: outer bucket on `traceId.keyword`, nested `terms` on `topLevelProcessName.keyword` (size 1) and `invocationType.keyword` (size 1).

### Provisioning gotcha
`docker restart grafana` does **not** pick up a new image. The container must be recreated (`docker compose up -d`). If a dashboard still shows stale after recreation, wipe the `grafana-data` volume.

---

## 6. Control Plane

`control-plane/` — nginx (TLS + basic auth) fronting a React SPA and an Express backend on internal `:3001`.

- `backend/server.js` (194 lines) — all routes
- `backend/config-renderer.js` — Handlebars render of `otel-collector-config.hbs`
- `backend/docker-client.js` — dockerode; restarts the collector via the mounted Docker socket
- `frontend/src/App.jsx` + `components/` — ConsumerCard, PipelineDiagram (reactflow), SourcesList, RetentionSettings
- `docker-entrypoint.sh` — generates `.htpasswd` from env vars and a self-signed cert on first run, seeds `/defaults/` into volumes, then starts node + nginx

### API

| Route | Behaviour |
|---|---|
| `GET /api/consumers` | read `consumers.json` from the `consumers-data` volume |
| `POST /api/consumers` | write JSON → render HBS → write collector YAML → restart collector → **roll back from `.bak` if it fails to come up** |
| `GET /api/status` | scrape `otel-collector:8888/metrics`, parse `otelcol_exporter_send_failed_*` per exporter |
| `GET /api/sources` | read discovered sources |
| `POST /api/sources/:name` | rename a source's label |
| `DELETE /api/sources/:name` | forget a source |
| `GET /api/retention` | read `min_index_age` from the `boomi-retention` ISM policy |
| `PUT /api/retention` | write the ISM policy with optimistic concurrency (`if_seq_no`/`if_primary_term`) |

Source discovery runs on a 30-second `setInterval`, aggregating `resources.service.name.keyword` from the logs index.

The apply-with-rollback path in `POST /api/consumers` is the most interesting code in the repo — it's what makes consumer toggling safe from a browser.

### Working on the control plane without the UI

Basic auth sits in nginx, so the simplest way to poke the API is from inside the container, bypassing it:

```bash
docker exec control-plane wget -qO- http://localhost:3001/api/consumers
```

The live `consumers.json` in the volume currently has a **real New Relic license key** in it. It is volume state, not git-tracked, and the key was scrubbed from git history in commit `ea15122` — keep it that way, and don't paste that file into anything shareable.

---

## 7. Known defects — verified live, all currently unfixed

These are real, reproduced today. They all stem from the same root cause: commit `6259dd4` fixed the Grafana datasource index patterns when Vector's naming changed, but missed every other place that hardcoded the old pattern.

### 7.1 Source auto-discovery is silently dead ⚠️

`control-plane/backend/server.js:44` queries `boomi-logs-*`. The real index is `boomi-logs`.

```
GET boomi-logs-*/_count  →  {"count":0}
GET boomi-logs*/_count   →  {"count":950003}
```

The catch block swallows everything, so it fails silently. The evidence is in the volume: the only discovered source has `last_seen: 2026-07-21T18:27:54Z` — frozen on exactly the day the index naming changed. **The Sources tab has been showing stale data for seven weeks.** One-character fix.

### 7.2 The retention ISM policy never matches anything ⚠️

`server.js:86` sets `ism_template.index_patterns` to `['boomi-logs-*', 'boomi-metrics-*', 'ss4o_traces-*']`. The first two match nothing, so **logs and metrics are never deleted** regardless of what the Retention tab says. Only traces age out. This is why `boomi-metrics` has grown to 8.46M docs / 594 MB.

Also worth knowing: ISM templates only apply to indices created *after* the policy is written, so fixing the pattern won't retroactively attach the policy to the existing `boomi-logs` / `boomi-metrics` indices — those need an explicit `_plugins/_ism/add` call.

### 7.3 Backend test suite fails (2 of 5)

```
Tests: 2 failed, 3 passed, 5 total
```

`__tests__/config-renderer.test.js` asserts the template renders `elasticsearch/logs`, `elasticsearch/metrics`, and `prometheusremotewrite/prometheus`, and that a `metrics:` pipeline exists. The test points at the repo-root template, where none of that is true — but the assertions aren't arbitrary. See 7.6: they match the *other* copy of the template.

### 7.6 The two HBS templates have diverged ⚠️

There are two copies, and they are not the same file:

- `otel-collector-config.hbs` (repo root) — **current**: traces-only, `opensearch/traces` exporter, one pipeline. Bind-mounted read-only in `docker-compose.yml`, so local dev always uses this one.
- `control-plane/defaults/otel-collector-config.hbs` — **stale**: the pre-Vector three-signal version. Still has `elasticsearch/logs` and `elasticsearch/metrics` exporters, `logs:` and `metrics:` pipelines, and the `prometheusremotewrite/prometheus` exporter.

The defaults copy is **baked into the published `otel-fanout-control-plane` image** and seeded by `docker-entrypoint.sh` whenever `$TEMPLATE_PATH` doesn't already exist. So any deployment that does not bind-mount the root template gets a collector configured with the `elasticsearch` exporters — the exact OpenSearch 3.5 incompatibility that caused the migration to Vector in the first place. **Verify whether the `observability-stack` quickstart compose bind-mounts the template; if it doesn't, published deployments are running the stale config.**

In practice the impact is muted today, because Boomi sends logs/metrics to Vector on 4317/4318 and only traces reach the collector — so the stale `logs:`/`metrics:` pipelines sit idle rather than failing loudly. It is a landmine, not an active fire. But it is why 7.3's tests fail: they were written against this copy and never moved.

Fixing this is a behavioural change to the published image and should be a deliberate decision, not a drive-by sync.

### 7.4 The Prometheus consumer card is a no-op

`consumers.default.json` and `ConsumerCard.jsx` both expose a "Prometheus (metrics only)" consumer with a Remote Write URL field. `otel-collector-config.hbs` has **no** prometheus block. Enabling it writes state that nothing reads. Either implement it or remove the card — and note that "metrics only" is meaningless on a traces-only pipeline anyway.

### 7.5 Stale index left behind
`boomi-metrics-2026-07-20` (86,944 docs) is orphaned from before the naming change. Safe to delete.

---

## 8. Diagnostics — read this before debugging "no data"

**When Grafana dashboards go blank, check OpenSearch first.** On 2026-08-28 OpenSearch was OOM-killed (exit 137) and stayed dead for two days without anyone noticing.

The failure is invisible from every other angle: Vector keeps accepting OTLP from the Atom and just retries forever (`dns error: failed to lookup address information: Name does not resolve` for host `opensearch`), so both the Atom and Vector look perfectly healthy. The only symptom is empty dashboards — which invites blaming whatever changed in Boomi most recently.

Diagnose bottom-up:

```bash
docker ps -a | grep opensearch                              # exit 137 / OOMKilled?
docker logs vector 2>&1 | grep "Name does not resolve"      # Vector retrying into the void
docker exec opensearch curl -s 'http://localhost:9200/_cat/indices/boomi-*?v'
./status-boomi-stack.sh                                     # doc counts + access points
```

Query OpenSearch **from inside the container**. A host-side `curl localhost:9200` can hang even when the cluster is fine.

### Editing a bind-mounted single file invalidates it inside long-running containers

`otel-collector-config.hbs`, `otel-collector-config.yaml` and `vector.toml` are each bind-mounted as a **single file**, not a directory. If an editor replaces such a file rather than truncating it in place, the container keeps a handle to the now-unlinked inode: `ls` inside the container still shows the old size with a **link count of 0**, and any `open()` returns `ENOENT`.

Hit live on 2026-09-16 — the control plane had been rendering from a dead handle, so a consumer save would have written a collector config with the transform processors missing. Restarting the collector masks it (it re-resolves the path); the control plane had been up for two days and did not.

```bash
docker exec control-plane ls -la /templates/      # link count 0 and a stale size = broken
docker-compose up -d --force-recreate control-plane
```

**After editing the root `.hbs`, recreate the control-plane container** — `docker restart` is not always enough.

### Other traps

- **OpenSearch disk watermark:** above 90% disk, index creation is blocked cluster-wide. Fix by raising watermarks via the cluster settings API and removing the read-only block. Run `docker builder prune -f` regularly on this machine.
- **Vector's HTTP OTLP endpoint only accepts `application/x-protobuf`**, not JSON. Boomi sends protobuf, so this is fine in practice — but it will bite anyone testing with a hand-rolled JSON curl.
- **`host.docker.internal` does not resolve on Linux/EC2.** Use the instance's private IP in the Atom's OTLP settings.
- **EC2 port conflicts** on 4317/4318 are common — Grafana Alloy and Tempo stacks grab them. Check `ss -tlnp | grep 4317` and remap the host side (e.g. `4327:4317`) if needed. Security group must open 4317, 4318, 4319, 4320, 3000, 8090.

---

## 9. Where this is heading

### Active plan: a generic, non-Boomi variant

The stack is agnostic under the branding, and the **control-plane image is the piece worth publishing** — the Vector and OTel wrappers are thin config layers over upstream images.

Approach: one Dockerfile, `ARG VARIANT=boomi|generic`, two published tags — a Boomi-defaults/Boomi-branded image and a generic one with `otel-*` indices and neutral branding. Maintain both in parallel.

Ranked enhancements for the broader release:

1. **AI-agent observability positioning** — highest leverage. LLM/agent telemetry (LangChain, OpenAI SDK, Copilot, crew.ai, LlamaIndex) is the fastest-growing observability gap with no clean self-hosted answer. Source discovery maps onto it directly; add pre-built profiles for known frameworks.
2. **Pre-built dashboards for the generic variant** — biggest single adoption lever; drops time-to-value from hours to minutes.
3. **Configurable OpenSearch endpoint** via `.env` — not swapping the backend, just allowing a managed service (AWS OpenSearch, Elastic Cloud). Roughly a one-line change.
4. **OpenAPI spec** for the control plane — low effort, but a credibility signal rather than a blocking need. Backlog until a customer asks.

Explicitly ruled out: HA/multi-node (rabbit hole), ClickHouse or Loki as storage backends (OpenSearch covers all three signals cleanly).

### Agent observability — the open research question

Boomi's Agent Control Tower (ACT) does **not** use standard OTel `gen_ai.*` semantic conventions. It uses a custom `resourceMetrics` JSON schema POSTed over HTTPS to a Boomi-hosted endpoint — not OTLP:

| OTel `gen_ai.*` | Boomi ACT |
|---|---|
| `gen_ai.system` | `providerType` (CREWAI, LANGCHAIN, BEDROCK) |
| `gen_ai.request.model` | `extModelId` |
| `gen_ai.usage.input_tokens` | `inputTokenCount` |
| `gen_ai.usage.output_tokens` | `outputTokenCount` |
| `gen_ai.operation.name` | `operation` |

Two candidate ingestion paths: **(a)** dual-instrument custom agents to send OTLP to `:4317`/`:4318` alongside the ACT POST, or **(b)** add a Vector `http` source pulling from an ACT export API — *if one exists*. **Whether ACT exposes an export or webhook for Boomi-native Agent Garden agents is the key unknown.** Source doc: developer.boomi.com, "Constructing custom provider agent metrics". Stakeholders: Ybrahim and Oliver, leading observability for Boomi and Solace.

No new stack components would be needed — just additional provisioned dashboards in the same Grafana image.

---

## 10. Publishing and repos

### Two public repos, different jobs

| Repo | Contents |
|---|---|
| `pythonicsshahdev/otel-fanout-quickstart` | **This working directory's remote.** Full source: dashboards, `grafana/`, `docs/`, `docker-compose.yml`, `vector.toml`, `control-plane/`. No install scripts. |
| `pythonicsshahdev/observability-stack` | End-user quickstart: `install-boomi-stack.sh`, `status-`, `start-`, `stop-`, `remove-`, plus a compose file that pulls `pythonicshahdev/otel-fanout-grafana:latest`. This is what install guides should link to. |

`boomi-internal/otel-fanout-quickstart` is **private** — any `curl` URL pointing at it returns 403 for external users.

### Pushing to GitHub

Two accounts are in the `gh` keyring. `shahabdullah-ai` is active by default and gets a **403** on `pythonicsshahdev` repos:

```bash
gh auth switch --user pythonicsshahdev
git push origin main
gh auth switch --user shahabdullah-ai
```

### Docker Hub (`pythonicshahdev`, all multi-arch amd64+arm64)

`otel-fanout-control-plane:latest` · `otel-fanout-grafana:latest` · `boomi-vector:latest`

**Always push `:latest` and `:YYYY-MM-DD` in a single build with two `-t` flags** — pushing separately wastes a build and risks the tags diverging:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t pythonicshahdev/otel-fanout-grafana:latest \
  -t pythonicshahdev/otel-fanout-grafana:YYYY-MM-DD \
  --push grafana/
```

### Outstanding doc debt

`Boomi_OTel_Install_Guide_v2.pdf` (internal Boomi audience) still has broken URLs on pages 3 and 5 — Method 1 and Method 2 `curl` at `boomi-internal/otel-fanout-quickstart`, which is private. They should point at `https://raw.githubusercontent.com/pythonicsshahdev/observability-stack/main/install-boomi-stack.sh`. Page 11's dashboard table lists 6, should list 10. The PDF can't be edited here — the source document needs updating and re-exporting. Everything else in it is accurate.

---

## 11. Repo map

```
docker-compose.yml            six services, all restart: always
vector.toml                   bind-mounted; overrides the image's baked config
otel-collector-config.yaml    LIVE config — rewritten by the control plane on save
otel-collector-config.hbs     Handlebars source the control plane renders from
prometheus/prometheus.yml     scrapes otel-collector:8888 and vector:9598
consumers.default.json        seed state for the consumers volume
status-boomi-stack.sh         container status + per-index doc counts
grafana/
  Dockerfile                  installs the OpenSearch plugin, bakes provisioning + dashboards
  provisioning/               datasources.yml, dashboards.yml
  dashboards/*.json           10 dashboards
control-plane/
  Dockerfile                  3-stage: backend deps → vite build → nginx+node
  docker-entrypoint.sh        htpasswd + self-signed cert + defaults seeding
  nginx.conf                  TLS :8090, basic auth, /api/ → localhost:3001
  backend/                    server.js, config-renderer.js, docker-client.js, __tests__/
  frontend/src/               App.jsx, api.js, components/
  defaults/                   baked-in seeds so the image runs standalone
docs/guides/                  setup guide (764 lines), raw telemetry samples + JSON fixtures
docs/superpowers/             original design specs and the fanout implementation plan
Dockerfile.vector/.otel       thin wrappers for the published images
```

`docs/guides/samples/` holds real captured `boomi-trace-sample.json`, `boomi-log-sample.json`, `boomi-metrics-sample.json` — the fastest way to see actual field shapes without querying.

---

## 12. Working agreements

- **Never use `_exists_` in a Grafana Lucene query.** See §5. It looks right and fails silently.
- **Keep `restart: always`.** See §3.
- **Index patterns are `boomi-logs*` / `boomi-metrics*`** — no dash. Grep for `boomi-logs-` before adding any new query; that's the bug in §7.1 and §7.2.
- **Don't commit secrets.** A New Relic key was already scrubbed from seven commits of history (`ea15122`). `.env`, `control-plane/ssl/`, and `control-plane/.htpasswd` are gitignored.
- **Recreate, don't restart, Grafana** after dashboard or provisioning changes.

---

## 13. Suggested first moves

The four defects in §7 are small, verified, and mutually independent — good first work:

1. `server.js:44` — `boomi-logs-*` → `boomi-logs*`. Restores source discovery.
2. `server.js:86` — fix `ism_template.index_patterns`, then `_ism/add` the policy to the existing indices so they actually age out.
3. Rewrite `__tests__/config-renderer.test.js` for the traces-only template; get to 5/5 green.
4. Decide the Prometheus consumer's fate — implement the HBS block or drop the card.

Then the larger question is whether to start the generic-variant fork (§9) or chase the ACT ingestion path, which needs an answer from Ybrahim/Oliver before it can be scoped.
