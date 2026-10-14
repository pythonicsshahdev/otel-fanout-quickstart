# Performance testing: port list between the two JMeter variants

**Status:** draft, 2026-10-13. Based on reading `IMPLEMENTATION_GUIDE.html` (the OTel-integrated lab) and the scaffolding in `BOOMI_Performance_Testing_POC/POC_DEVELOPMENT/` (the lightweight kit, in active development). Nothing in the lightweight project was modified. The lab's `perf/` source (github.com/johnvillani-demo/boomi-performance-observability, private, readable with `gh`) was read on 2026-10-13: `docker-compose.yml`, `run-test.sh`, `ramp.sh`, `jmeter/Dockerfile` and `boomi_gateway.jmx`. The dashboard JSON was read for A7. Other plans and the sample target were listed but not read.

## Model

- **Lightweight kit** (other project): JMeter + Prometheus + Grafana, no OTel dependency. General-purpose for REST, SOAP and GraphQL, low-code author audience. It is the shared core.
- **OTel-integrated variant** (this repo): the same core plus Boomi OTel correlation, Data Hub snapshots and the Agent Studio agent. It consumes the core and does not fork it.

Direction of dependency: lab consumes kit. Preferred mechanism is a tagged release or published image, so plans and runner scripts cannot drift between two copies.

## A. Port from the lab into the lightweight kit

The kit's own spec requires goals 2 (compare runs) and 3 (reproducible images) but has not built them yet.

| # | Item | Why | State in kit | Notes |
|---|---|---|---|---|
| A1 | Per-run `run_id` via Prometheus file-based service discovery | Spec goal 2: runs must be comparable, not one blended series | `prometheus.yml` has a static target `jmeter:9270` | Lab's `run-test.sh` writes `[{"targets":["perf-jmeter:9270"],"labels":{"run_id":...}}]` to `/etc/prometheus/targets/jmeter.json` via `docker cp`, then runs JMeter. Must `chmod 644` first: `mktemp` makes 600, Prometheus runs as another user and silently skips the file. In the kit, prefer a shared bind-mounted `targets/` dir over `docker cp`. **The `file_sd` job itself is not in `perf/`** (only `backup/prometheus.yml.before-perf`), so write it fresh. |
| A2 | `run-test.sh` | Spec's architecture lists it; it is the place A1 lives | Not present | Lab version is 40 lines: `run_id=run-<timestamp>`, passes `key=value` args as `-J` properties, writes `.jtl` and `.log` per run, checks containers are up. Lab execs into an idle `perf-jmeter` container; the kit uses `docker compose run` (profile `tools`), so adapt that line. Plans read `threads`, `rampup`, `duration`, `think_ms`, `host`, `port`, `protocol` via `__P()`, which suits the low-code audience. |
| A3 | `ramp.sh` (step load, steady-state only, stop rule) | Finds the knee; warm-up excluded; protects the target | Not present | Stop at >2 % errors or >3 s average (env-tunable), warm-up dropped, table saved as markdown. Needs host `python3`. CPU sampling defaults to `Boomi_MiniRTEST`, so make `TARGET_CONTAINER` optional. The sampler loop is clumsy (a `timeout tail` as a sleep); rewrite it, don't copy it. |
| A4 | 1 s scrape interval | Lab measured a 5 s scrape under-counting by 7–11 %; 1 s gave ~3 % | `scrape_interval: 5s` | One-line change. |
| A5 | Plugin download integrity check | Lab verified checksums at build | Dockerfile downloads with `curl` only, no hash | Copy the lab's pattern: JMeter `.sha512` from archive.apache.org, plugin `.sha1` from Maven Central. **Maven Central has no 0.7.1** (404), though the GitHub release URL the kit uses does exist (200). Either pin 0.6.0 and keep the checksum, or pin 0.7.1 and hash the GitHub jar yourself. |
| A6 | Plugin property names | Lab found them by inspecting the jar | Kit's `jmeter.properties.append` sets `prometheus.ip` and `prometheus.port` | The lab passes `-Jprometheus.ip=0.0.0.0` on the command line (0.6.0), so the names are right for 0.6.0. **Still verify** them in 0.7.1. |
| A7 | Grafana dashboard JSON (**built: `docs/perf-kit/jmeter-core-dashboard.json`, panels 1–8, datasource is a `${DS_PROMETHEUS}` picker, uid `boomi-perf-jmeter-core`; not yet imported into any Grafana**) | Throughput, error rate, percentiles, run-over-run comparison | `grafana/dashboards/` and both `provisioning/` folders are empty | Lab dashboard `boomi-perf-jmeter` (11 panels, 5 s refresh, 30 m window, one `run_id` multi-select variable from `label_values(jmeter_requests_total, run_id)`). **Panels 1–8 are pure Prometheus and portable as is:** requests/s, error rate, worst-sampler p99, total requests (`max_over_time[24h]`), throughput by sampler, p50/p90/p99 by sampler, errors by HTTP code, run-over-run p99 by `run_id`. They use only `jmeter_requests_total`, `jmeter_failures_total`, `jmeter_response_time_ms` and the labels `label`, `code`, `quantile`, `run_id`. **Panels 9–11 stay in the OTel variant** (OpenSearch queries on `otelperf` routes and `Execute process`; panel 9 is a mixed-datasource client/runtime/process comparison). Before porting: the Prometheus datasource UID is hard-coded as `otel-collector-prom`; change it to the UID the kit provisions, or make it a `${DS_PROMETHEUS}` input. Panel 9's JMeter query filters `label=~"Boomi.*"`, which is lab-specific. Keep `jmeter_*` metric names unchanged so one JSON serves both variants (not yet verified against 0.7.1). |
| A8 | Mounted API-key file pattern | Key never appears in a plan, command line or log | Kit uses `.env` via `${__env(...)}` | Lab mounts `~/.config/boomi-perf` read-only at `/jmeter/secrets` and plans use `${__FileToString(/jmeter/secrets/gateway.key,UTF-8,)}`; header name and scheme are `__P()` params (default `x-api-key`). Different mechanism, same goal. Decide which the kit standardises on. `.env` is simpler for the audience; a mounted file keeps the value out of container env. |
| A9 | Little's Law sanity check | Cheap way to confirm a results table is consistent | None | Document it, or add a small script. Optional. |
| A10 | Gateway forwarder (`alpine/socat`) and API-Management plan | Needed by anyone testing through API Management | None | Lab's forwarder is one service: `TCP-LISTEN:9190,fork,reuseaddr TCP:Boomi_MiniRTEST:9091`, with the container name and ports hard-coded; parameterise them. Make it an optional compose profile. Boomi-specific but not OTel-specific. |

## B. Stays in the OTel-integrated variant only

These need the OTel stack or Boomi platform components and should not move into the kit.

- Dashboard panel comparing client time, runtime time and process time.
- Boomi listeners and the API Service wrapper (`OtelPerf_API`), the cross-reference table and the `(API)perf_*` processes.
- `perf_snapshot_refresh`, the Data Hub `processPerformance` universe, and the Agent Studio agent with its tools.
- Reuse of the existing Prometheus and Grafana, plus the network attachment to the observability and runtime networks.
- Low-latency-mode findings and any run-to-trace correlation. Correlation is an explicit non-goal in the kit's spec, so keep it here.

## C. Port from the lightweight kit into the lab

| # | Item | Why |
|---|---|---|
| C1 | GraphQL sample service (FastAPI + Strawberry) | The lab's mock target covers REST, GraphQL and SOAP in one container. If the kit's image is published, the lab can drop its own copy. *Verify* feature parity (injectable delay and failures exist in the lab's mock). |
| C2 | `jmeter-gui` (noVNC) authoring container | Lab authored plans by hand. Gives its authors the same GUI path. Not yet built in the kit. |
| C3 | Published `boomi-jmeter` image | Lets the lab drop its own Dockerfile and pull the kit's image. Blocked until the kit tags a release. |
| C4 | Starter plan structure (`rest/`, `graphql/`, `soap/`) | Lab's plans (`boomi_listeners.jmx`, `boomi_gateway.jmx`, A/B, capacity) would sit as a Boomi-specific folder next to these. |

## D. Decisions needed

1. **Packaging:** submodule, published image, or tagged copy. Recommendation: published image plus a pinned tag.
2. **Secrets:** `.env` + `${__env()}` (kit) vs a mounted read-only file (lab). Pick one for the shared core.
3. **Prometheus ownership:** the kit bundles its own; the lab reuses the OTel stack's. The core should work in both, so make the scrape config mountable instead of baked in.
4. **k6 spec in this repo:** `docs/superpowers/specs/` has a k6 kit design (`224fb82`, `33ca06c`). The kit's spec already records JMeter as the engine decision. Mark the k6 spec superseded or parked so it is not built by accident.
5. **Plugin version:** reconcile 0.6.0 vs 0.7.1 after A6.

## E. Suggested order

1. Kit: A4 and A5 (small, independent).
2. Kit: A1 and A2 (`run_id`), then A6 verification.
3. Kit: A7 (dashboard), then tag a release.
4. Lab: switch `perf/` to the kit's image (C3), keep section B in place.
5. Optional: A3, A10, C2.

## Open items not verified

- The other five lab plans: listed, not read. Needed for C4. (The dashboard JSON was read; see A7.)
- The lab's 1 s `jmeter` scrape job is not in `perf/`; it lives in the OTel stack's Prometheus config in this repo or the guide's setup. Locate it before A4.
- Whether the lab and kit share any Prometheus metric label names, which affects reusing the dashboard.
- That the kit's `jmeter-gui` image builds (only the supervisord config exists so far).

## F. Parked: verify on a real runtime cluster and elastic runtime

Not tested yet. A three-node Docker cluster was judged too hard (shared storage with file locking). Verification will use another Molecule later. Both topologies must be checked:

- **Runtime cluster on VMs and elastic (Kubernetes) runtime:** does every node send OTLP, and can nodes reach the collector (inbound route, unlike the single-laptop lab)?
- **Refresh process:** it reads OpenSearch from inside a runtime; a cluster runtime must be able to reach OpenSearch.
- **Per-node split:** find the span or resource field that carries the node or pod name (`tags.jvm.id` is molecule-only).
- **Capacity numbers:** the single-node knee (5–10 users, ~7 req/s) does not transfer; re-measure behind the real load balancer, and check balancing evenness.
- **Elastic runtime:** `ramp.sh` CPU sampling uses `docker stats` on one container (needs pod metrics instead); autoscaling confounds a ramp, so pin replicas or record pod count per step; pod names are not stable.
- **Cheaper interim check of our own plumbing:** three independent runtimes behind a load balancer (not a cluster).
