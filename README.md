# RouteForge

**An AI safety gate that catches the bugs your tests can't.**

Normal code review catches syntax errors, style issues, and test failures.  
It cannot catch: *"This change looks correct but will route a tanker through an active blockade."*

RouteForge catches that. Before the MR merges.

---

## The problem it solves

A developer opens a merge request: `"perf: +12% throughput via precomputed routing tables"`.

Tests pass. CI is green. The diff looks clean. Reviewers see the performance numbers and approve.

What nobody noticed: buried in that 300-line diff, the crisis avoidance block was quietly deleted.

```python
# This block — removed in the "performance" MR
if "HORMUZ" in avoid_straits:
    # Reroute via Cape of Good Hope during active blockade
    route = RouteSegment(waypoints=["ZACPT"], distance_nm=route.distance_nm * 1.18)
```

Three weeks later, Hormuz closes. Your algorithm sends ships straight through.  
**Insurance claim: $40M. Criminal liability. Company destroyed.**

This is not a hypothetical. Business-critical algorithms change constantly. Crisis scenarios are never in the test suite. And no human reviewer reads 300-line diffs looking for missing safety checks.

---

## What RouteForge does

Within 60 seconds of the MR opening, GitLab shows this — pinned to the exact dangerous line:

```
algorithms/dynamic_path.py, line 72

🚫 RouteForge: Hormuz avoidance removed here

This line guarded all strait routing during active crises.
Removing it causes vessels to transit Hormuz during blockades —
failing scenarios: `hormuz_crisis_01`, `hormuz_crisis_02`.

Fix: reinstate `if "HORMUZ" in avoid_straits:` block before merging.

🤖 RouteForge AI Safety Gate
```

The MR gets label `routeforge::blocked`. It cannot be merged until a human reviews and the developer fixes the issue.

---

## This is not just for shipping

The demo uses maritime routing. The product works for any domain with critical business logic:

| Domain | Algorithm | Crisis scenario |
|--------|-----------|-----------------|
| Shipping | Route calculation | Strait blockade, port closure |
| Insurance | Claims routing | Catastrophe event, fraud spike |
| Finance | Fraud scoring | Flash crash, market circuit breaker |
| Healthcare | Drug dosage | Allergy interaction, supply shortage |
| Energy | Grid load balancing | Blackout, demand surge |

Same product. Different fixtures. Any team that ships code affecting real-world outcomes.

---

## How it works

```
Developer opens MR
        │
        ▼
GitLab webhook fires → RouteForge API (Cloud Run)
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│                    ADK Sequential Pipeline                    │
│                                                              │
│  1. CommitWatcher    — fetches diff via GitLab REST API      │
│  2. Critic           — scans diff for prompt injection       │
│  3. PipelineObserver — reads CI status + failing job logs    │
│  4. ScenarioTester   — runs diff against crisis fixtures     │
│  5. CodeContextAnalyzer — semantic_code_search via MCP       │
│  6. RiskGate         — Gemini structured verdict: PASS/BLOCK │
│  7. Critic           — challenges verdict, checks reasoning  │
│  8. ChangelogWriter  — Gemini drafts comment body            │
│  9. InlineCommenter  — finds dangerous line, posts via MCP   │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
Human reviews verdict in dashboard
        │
        ▼ (human approves)
GitLab MR gets: inline thread + verdict comment + label + approval
```

Every LLM call uses **Gemini 2.5 Flash via Vertex AI**. All credentials in GCP Secret Manager. Human approval mandatory before any action on GitLab.

---

## GitLab integration — three channels, deep usage

RouteForge doesn't just use GitLab as a git host. It uses GitLab as the operating surface.

### Channel 1 — Webhooks (entry point)
Merge request events and pipeline events fire into RouteForge the instant something changes. No polling. No delay.

### Channel 2 — MCP (AI-native tools)
RouteForge uses the **zereight/gitlab-mcp** server (Streamable HTTP transport) for two operations that REST cannot do as well:

- `search_project_code` — semantic search across the repo to find files related to the changed functions (CodeContextAnalyzer)
- `create_merge_request_thread` — posts inline comment **pinned to the exact line** that introduced the dangerous change (InlineCommenter)

### Channel 3 — REST API (workhorse)
Every operational action uses the GitLab REST API with a scoped Project Access Token:

| Action | Endpoint |
|--------|----------|
| Fetch MR diffs | `GET /merge_requests/{iid}/diffs` |
| Fetch diff refs (base/head/start SHA) | `GET /merge_requests/{iid}` |
| Post verdict comment | `POST /merge_requests/{iid}/notes` |
| Apply scoped label | `PUT /merge_requests/{iid}` |
| Approve MR | `POST /merge_requests/{iid}/approve` |
| Create issue for BLOCK | `POST /issues` |
| Fetch CI pipeline | `GET /pipelines` + `GET /jobs` |
| Create/ensure labels | `POST /labels` |

### `@routeforge` commands
Comment on any MR to interact with RouteForge directly in GitLab:

```
@routeforge explain      — explain why this scenario failed
@routeforge scenarios    — list active crisis scenarios
@routeforge status       — current pipeline and CI status
@routeforge help         — list available commands
@routeforge <anything>   — Gemini answers in context of the verdict
```

---

## AI specialists

| Specialist | What it does |
|------------|--------------|
| `CommitWatcher` | Parses webhook, fetches diffs + diff refs from GitLab REST |
| `ScenarioTester` | Parses diff signals, simulates algorithm against crisis fixtures — no LLM, deterministic |
| `CodeContextAnalyzer` | Calls `search_project_code` via MCP to find semantically related files |
| `PipelineObserver` | Fetches CI status, failing job names, coverage from GitLab |
| `RiskGate` | Gemini structured output: pre-classifies each scenario (SAFETY MISS / REROUTE MISS / FALSE BLOCK), produces PASS/BLOCK verdict with calibrated confidence |
| `ChangelogWriter` | Gemini drafts the comment body posted to the MR |
| `Critic` | Runs twice: scans diff for prompt injection before pipeline starts, challenges verdict after RiskGate |
| `InlineCommenter` | Finds exact old_line of dangerous change via diff parsing, posts thread via MCP |
| `ChatHandler` | Handles `@routeforge` note commands + dashboard chat, context-aware Gemini responses |

---

## Verdict classification

RiskGate pre-classifies each scenario result before Gemini sees it. Gemini cannot be confused by edge cases — it gets structured labels:

| Label | What happened | Gemini rule |
|-------|---------------|-------------|
| `SAFETY MISS` | Crisis scenario — route should be blocked, wasn't | → BLOCK, no exceptions |
| `REROUTE MISS` | Crisis scenario — reroute expected, not provided | → BLOCK |
| `NORMAL DISRUPTION` | Non-crisis route blocked when it shouldn't be | → BLOCK (regression) |
| `FALSE BLOCK` | Route blocked during non-crisis (algorithm too aggressive) | → BLOCK |
| (none) | All scenarios behaved as expected | → PASS |

Confidence calibration: 0.85–1.0 (multiple clear failures, matching functions) → 0.10–0.40 (ambiguous, sparse data).

---

## Dashboard

Live at: `https://routeforge-dashboard-336382452417.us-central1.run.app`

| Component | Description |
|-----------|-------------|
| `VerdictFeed` | Live-polling verdict cards — BLOCK/PASS, confidence, GitLab label chip, inline approve button, rendered comment draft, scenario suggestions |
| `StatsBar` | MRs scanned, blocked count, pass count, avg confidence — updates live |
| `TrendPanel` | Sparkline of last 7 verdicts, top failing scenario, safety score, streak counter |
| `PipelineLog` | SSE-connected real-time stream of agent steps as they execute |
| `DiffViewer` | Side-by-side diff with line numbers + function highlighting |
| `ScenarioEditor` | Scenario library — add/edit/delete, Gemini auto-generate from plain English description |
| `ChatPanel` | Chat with Gemini in context of any MR verdict |

---

## Scenario library

Per-project crisis scenarios stored as JSON. Default scenarios cover:

- Hormuz blockade (crude oil, LNG, container vessels)
- Suez Canal disruption
- Malacca Strait chokepoint
- Panama Canal drought closure
- Cape of Good Hope reroute validation

Add your own via the dashboard or REST API. Gemini can generate scenarios from a plain English description: `"What if both Suez and Hormuz close simultaneously during LNG peak demand?"`.

```
GET    /scenarios/{project_id}           — list
POST   /scenarios/{project_id}           — create
PUT    /scenarios/{project_id}/{id}      — update
DELETE /scenarios/{project_id}/{id}      — delete
POST   /scenarios/{project_id}/generate  — Gemini auto-generate
```

---

## Security

**Prompt injection defense:** Every piece of user-controlled content (diffs, MR titles, note bodies, file content) is labeled `[DATA]` in Gemini prompts and structurally isolated from instructions. Critic scans for injection patterns before and after the pipeline. Constrained structured output on all Gemini calls. Human approval gate mandatory before any GitLab action.

**Secrets:** All credentials in GCP Secret Manager. Nothing hardcoded. Nothing in `.env`. Nothing in config YAML in plaintext.

---

## Stack

| Layer | Technology |
|-------|------------|
| Agent runtime | Python ADK, FastAPI, Cloud Run |
| LLM | Gemini 2.5 Flash via Vertex AI |
| GitLab integration | Webhooks + MCP (zereight/gitlab-mcp) + REST API |
| Dashboard | Next.js 14, Tailwind CSS, TanStack Query |
| Observability | structlog, Cloud Logging |
| Tests | pytest, pytest-asyncio |

---

## Run locally

```bash
# Agent
pip install -r requirements.txt
GITLAB_PAT=xxx GITLAB_WEBHOOK_SECRET=xxx uvicorn agent.webhooks:app --reload

# Dashboard
cd dashboard && npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

```bash
# Tests
pytest tests/
```

---

## Deploy

```bash
# Agent
docker build --platform linux/amd64 -t gcr.io/shipsafe-ai/routeforge:latest .
docker push gcr.io/shipsafe-ai/routeforge:latest
gcloud run deploy routeforge \
  --image gcr.io/shipsafe-ai/routeforge:latest \
  --region us-central1 --allow-unauthenticated

# Dashboard
cd dashboard
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://routeforge-o34wppiwiq-uc.a.run.app \
  -t gcr.io/shipsafe-ai/routeforge-dashboard:latest .
docker push gcr.io/shipsafe-ai/routeforge-dashboard:latest
gcloud run deploy routeforge-dashboard \
  --image gcr.io/shipsafe-ai/routeforge-dashboard:latest \
  --region us-central1 --allow-unauthenticated
```

---

## Live services

| Service | URL |
|---------|-----|
| Agent API | `https://routeforge-o34wppiwiq-uc.a.run.app` |
| Dashboard | `https://routeforge-dashboard-336382452417.us-central1.run.app` |
| MCP server | `https://routeforge-mcp-336382452417.us-central1.run.app/mcp` |
