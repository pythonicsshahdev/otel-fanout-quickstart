# k6 Load Testing Kit for Boomi APIs — Design

## Purpose

A standalone k6 setup for load-testing Boomi-published APIs (API Management /
basic-auth or API-key secured endpoints), with results visualized in Grafana.
It must not be dependent on, or wired into, the main OTel Fanout stack
(`docker-compose.yml` at the repo root) — it is its own project that happens
to live in this repo, under `k6/`.

**Who's implementing:** the user hand-types every file and runs every
command themselves. This spec and the companion implementation plan are
reference material — the file contents, directory layout, and commands shown
here are what to aim for, typed by hand, not something Claude writes with
Write/Edit. Claude's role during implementation is to review files after
they're written and help debug.

## Non-goals (this phase)

- **Trace/span correlation** with the existing API Performance dashboard
  (`grafana/dashboards/api-performance.json`) is explicitly deferred. It's
  unconfirmed whether the target Boomi process maps any incoming request
  value into `correlationId`/`transactionId` for its Notify-shape message.
  The only forward-compatible hook kept from that idea: every k6 request
  carries an `X-LoadTest-Run-Id` header, so wiring this up later (echoing it
  into a Notify `key=value` pair and adding an OTTL extraction rule in
  `otel-collector-config.yaml`) is a small follow-up, not a redesign.
- No changes to the root `docker-compose.yml`, `otel-collector-config.yaml`,
  or any main-stack file.
- No custom k6 image with the script baked in (stays a mounted volume) — only
  the Grafana image gets built and published.
- No multi-scenario test harness. One parameterized script, documented so
  more can be added the same way later.

## Architecture

```
k6/                             <- standalone project, own directory
├── docker-compose.yml          <- k6 + its own Prometheus + its own Grafana
├── .env.example
├── README.md                   <- usage instructions for this kit specifically
├── scripts/
│   └── api-load-test.js        <- ramping-VU script, env-driven target/auth
├── prometheus/
│   └── prometheus.yml          <- remote-write receiver on, minimal self-scrape
└── grafana/
    ├── Dockerfile              <- bakes in provisioning (published to Docker Hub)
    ├── provisioning/
    │   ├── datasources/prometheus.yml
    │   └── dashboards/dashboards.yml
    └── dashboards/
        └── k6-load-test.json
```

Data flow:

```
k6 (load generator) --HTTPS--> Boomi API (external, via API Management)
   |--remote_write--> prometheus (bundled, --web.enable-remote-write-receiver)
                           |--PromQL query--> grafana (bundled, port 3001)
```

**Isolation from the main stack:**
- Own bridge network (`k6-net`), own named volumes (`k6-prometheus-data`,
  `k6-grafana-data`) — distinct from `boomi-net` and the main stack's
  volumes.
- Own `docker-compose.yml`, invoked from inside `k6/` — a completely separate
  Compose project with its own lifecycle. `docker compose -f k6/docker-compose.yml ...`
  or `cd k6 && docker compose ...`, either works; the README documents the
  `cd k6` form since that's what the bundled relative paths assume.
- Host ports chosen to avoid collision if both stacks run at once on the
  same machine: Grafana on `3001` (main stack uses `3000`), Prometheus on
  `9091` (main stack doesn't expose Prometheus to the host at all).
- **Escape hatch, not default:** `K6_PROMETHEUS_RW_SERVER_URL` in `.env` can
  be repointed at a different Prometheus (e.g. the main stack's, if its port
  were exposed) for anyone who later wants to consolidate metrics instead of
  running the bundled Prometheus/Grafana. Default behavior needs none of
  this — `docker compose up` just works standalone.

## Components

### `k6/scripts/api-load-test.js`

- Ramping-VU load profile, stages hardcoded but trivially editable (the
  script is bind-mounted, not baked into an image, so editing needs no
  rebuild):
  ```js
  export const options = {
    stages: [
      { duration: '30s', target: 10 },
      { duration: '2m', target: 20 },
      { duration: '30s', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<3000'],
      http_req_failed: ['rate<0.05'],
    },
  };
  ```
  The 3s p95 / 5% error-rate thresholds are starting defaults sized for a
  Boomi Atom that may be cold-starting — tune after a first real run.
- Auth, read from environment variables so no credentials are hardcoded:
  - `BASE_URL` — required, the Boomi API Management endpoint.
  - `AUTH_MODE` — `basic` or `apikey` (default `basic`).
  - `basic`: `BASIC_USER` / `BASIC_PASS` → sent as an `Authorization: Basic`
    header (base64-encoded in the script, not via k6's http auth param, so
    it works uniformly across GET/POST).
  - `apikey`: `API_KEY_HEADER` (header name, e.g. `X-API-Key`) /
    `API_KEY_VALUE`.
- Every request carries `X-LoadTest-Run-Id: <value>` — a per-script-execution
  UUID (generated once via k6's `__ENV` or a `k6/execution` scenario-start
  value, not per-iteration) so a single test run is identifiable as one unit
  if correlation work happens later.
- `checks`: status code is 200 (or whatever 2xx the target API returns —
  make this configurable via `EXPECTED_STATUS` / `.env`'s `K6_EXPECTED_STATUS`,
  default `200`).

### `k6/prometheus/prometheus.yml`

- `--web.enable-remote-write-receiver` passed as a container command flag
  (not a config-file setting).
- Minimal `scrape_configs`: self-scrape only (`job_name: prometheus`,
  target `localhost:9090`) for basic Prometheus-health visibility. No scrape
  target for k6 — metrics arrive via push (remote_write), not pull.

### `k6/grafana/`

- `Dockerfile`: `FROM grafana/grafana:latest`, `COPY provisioning/` and
  `COPY dashboards/` — no plugin install needed (unlike the main stack's
  Grafana, which needs the OpenSearch datasource plugin). This mirrors the
  existing `grafana/Dockerfile` pattern of baking provisioning in so the
  published image "works standalone from Docker Hub."
- `provisioning/datasources/prometheus.yml`: one Prometheus datasource
  pointed at `http://prometheus:9090` (the bundled one, service-name
  resolution inside `k6-net`).
- `provisioning/dashboards/dashboards.yml`: file-provider pointing at
  `/etc/grafana/dashboards`, same shape as the main stack's.
- `dashboards/k6-load-test.json`: panels built from k6's Prometheus
  remote-write metric names (`k6_http_reqs_total`, `k6_http_req_duration`,
  `k6_vus`, `k6_http_req_failed`, `k6_iterations_total`):
  - VUs over time
  - Request rate (req/s)
  - Latency p50/p95/p99
  - Error rate (`http_req_failed`)
  - Status-code breakdown

### `k6/docker-compose.yml`

- Three services: `k6`, `prometheus`, `grafana`.
- `k6` service: `image: grafana/k6:latest`, mounts `./scripts:/scripts:ro`,
  `command: ["run", "--out", "experimental-prometheus-rw", "/scripts/api-load-test.js"]`,
  environment carries `K6_PROMETHEUS_RW_SERVER_URL` plus the script's own
  env vars (`BASE_URL`, `AUTH_MODE`, etc.) sourced from `.env`. Behind a
  Compose `profiles: ["run"]` entry so a bare `docker compose up -d` doesn't
  fire a load test — it's triggered explicitly.
- `prometheus` / `grafana`: no profile — these are the persistent pieces you
  leave running to review results. **Do not** copy the main stack's
  `restart: always` here: this is a local testing kit, not a production
  service, and the default restart policy (`no`) is correct so a crashed
  container surfaces as "down," not as a silent gap in the dashboard.
- Env var naming: `.env` uses a `K6_`-prefixed name for every setting
  (`K6_BASE_URL`, `K6_AUTH_MODE`, `K6_GRAFANA_PASSWORD`, …) to namespace this
  kit's env file, but each tool inside the container expects its own
  unprefixed name (the k6 script reads `BASE_URL`/`AUTH_MODE`/etc., Grafana
  reads `GF_SECURITY_ADMIN_PASSWORD`). `docker-compose.yml`'s `environment:`
  blocks are where that mapping happens, e.g. `BASE_URL=${K6_BASE_URL}` on
  the `k6` service and `GF_SECURITY_ADMIN_PASSWORD=${K6_GRAFANA_PASSWORD}`
  on the `grafana` service — mirrors how the root `docker-compose.yml` maps
  `${GRAFANA_PASSWORD}` today.

### `k6/.env.example`

```
K6_BASE_URL=https://your-boomi-api-host/ws/rest/v1
K6_AUTH_MODE=basic
K6_BASIC_USER=
K6_BASIC_PASS=
K6_API_KEY_HEADER=
K6_API_KEY_VALUE=
K6_EXPECTED_STATUS=200
K6_GRAFANA_PASSWORD=changeme
K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write
```

### `k6/README.md`

Short, matching the main README's per-component style:
- What this is, that it's standalone (no dependency on the root stack).
- `cp .env.example .env` then edit.
- `docker compose up -d prometheus grafana` → `docker compose run --rm k6`
  → view results at `http://localhost:3001`.
- How to point at an external/main-stack Prometheus instead (the escape
  hatch env var), for anyone who wants to consolidate later.
- Pointer to the non-goals above (no trace correlation yet).

## Docker Hub Publishing

Only the Grafana image gets published — matching the existing project
convention where stock images with just a mounted config (Prometheus here,
same as the main stack's Prometheus) aren't worth publishing, but a Grafana
image with baked-in provisioning is, because it's what makes the kit
"`docker pull` and go" for someone who doesn't clone the repo.

- **Image name:** `pythonicshahdev/boomi-k6-grafana` (new image, separate
  from the main stack's `pythonicshahdev/otel-fanout-grafana` — different
  dashboard/datasource, shouldn't be conflated).
- **Tags:** both `:latest` and `:YYYY-MM-DD` pushed together in one command,
  per the project's existing rule for Grafana image pushes.
- **Build command** (run by hand, from `k6/`):
  ```
  docker buildx use multiarch
  docker buildx build --platform linux/amd64,linux/arm64 \
    -t pythonicshahdev/boomi-k6-grafana:latest \
    -t pythonicshahdev/boomi-k6-grafana:YYYY-MM-DD \
    --push grafana/
  ```
  Uses `docker buildx` (not `docker compose build`) because a multi-arch
  push needs the `multiarch` builder, consistent with how this machine's
  Docker CLI plugins are set up (`docker compose`/`docker buildx` as
  top-level `docker` subcommands are broken here — the standalone
  `docker-compose` binary and a manually-linked `buildx` plugin are the
  working substitutes).
- **Verify:** `docker buildx imagetools inspect pythonicshahdev/boomi-k6-grafana:latest`
  should list both `linux/amd64` and `linux/arm64`.
- `k6/docker-compose.yml` keeps building the Grafana image **locally**
  (`build: context: ./grafana`) for day-to-day use in this repo — the
  published image is for external consumers who want to run the kit without
  cloning the repo (same relationship as the main stack's Grafana: built
  locally here, also published for the quickstart repos).

## Testing / Verification

No business logic to unit-test in the Dockerfile/compose/dashboard-JSON
pieces — those are declarative config, verified by running them. The k6
script is the one piece with actual branching logic (auth-mode selection,
header construction, status checks), and that gets isolated, no-real-target
verification before it ever touches a real Boomi endpoint.

1. **Script dry-run, no real target.** Before pointing at Boomi at all, run
   the script at minimal scale against a public echo endpoint:
   ```
   docker compose run --rm -e BASE_URL=https://httpbin.org -e AUTH_MODE=basic \
     -e BASIC_USER=user -e BASIC_PASS=pass \
     k6 run --vus 1 --iterations 1 /scripts/api-load-test.js
   ```
   using `https://httpbin.org/basic-auth/user/pass` as the path under test —
   confirms the script parses, the auth branch builds the right header, and
   checks pass, independent of load-generation concerns.
2. **Both auth branches exercised**, not just the default — repeat step 1
   with `AUTH_MODE=apikey` / `API_KEY_HEADER` / `API_KEY_VALUE` against
   `https://httpbin.org/headers` (asserting the header round-trips in the
   response body) — so the untested branch isn't the one that breaks during
   a real run.
3. **`docker compose config`** — validates the compose YAML and `.env`
   substitution (catches the `K6_*` → unprefixed env var mapping being
   wrong) before the first real `up`.
4. **Full dry run.** `docker compose up -d prometheus grafana` — confirm
   both containers report healthy/running — then `docker compose run --rm k6`
   against the real target (or `httpbin.org` again if the real endpoint
   isn't ready yet) at the full ramping profile — confirm k6 exits 0 (or
   reports threshold failures clearly, not a crash).
5. **Dashboard verification via API, not just eyeballing.** This stack has
   a standing lesson that panels can silently read zero (an aggregation/
   `min_doc_count` trap bit the OpenSearch dashboards before) — don't trust
   "the page rendered." After step 4, hit each k6 dashboard panel through
   Grafana's `/api/ds/query` and confirm non-empty series for VUs, request
   rate, latency percentiles, and error rate — not just that
   `http://localhost:3001` loads.
6. **If publishing:** after the buildx push, run a fresh `docker compose up`
   against the **published** image (temporarily swap `build:` for
   `image: pythonicshahdev/boomi-k6-grafana:latest` in a scratch copy, or
   just pull-and-run it standalone) to confirm it comes up pre-provisioned
   with no local `grafana/provisioning` mount needed.
