# RouteForge

**An AI safety gate that catches the business-logic bugs your tests will never find.**

Tests verify that your code runs. They cannot verify that your algorithm still makes the right decision in a crisis it's never seen.

RouteForge does.

---

## The problem, stated plainly

Your team ships a performance improvement to a routing algorithm: `+12% throughput via precomputed path tables`. Tests pass. CI is green. The diff is 300 lines of clean refactoring. Reviewers approve it.

Buried in line 247, this block was quietly removed:

```python
if "HORMUZ" in avoid_straits:
    # Reroute via Cape of Good Hope during active blockade
    route = RouteSegment(waypoints=["ZACPT"], distance_nm=route.distance_nm * 1.18)
```

Nobody noticed. The test suite never includes "active Hormuz blockade" as an input. The performance metric improved. The safety invariant silently vanished.

Three weeks later, Hormuz closes. Your algorithm — which no longer knows about blockades — routes three tankers straight through. Two are detained. One is damaged. $40M insurance claim. Criminal liability.

**This is not a shipping problem. It is a software problem.**

Any team with business-critical algorithms faces this:

| Domain | Algorithm | Crisis nobody tests |
|---|---|---|
| Maritime routing | `route_optimizer.py` | Strait closure, active blockade |
| Fraud detection | `score_transaction()` | Flash crash, velocity burst from legitimate source |
| Insurance claims | `route_claim()` | Catastrophe event, CAT5 classification |
| Drug dosage | `calculate_dose()` | Allergy interaction, contraindication |
| Grid load | `shed_load()` | Blackout condition, >40% demand spike |

Same failure mode everywhere: a change looks correct, the crisis case wasn't in the test suite, and a safety invariant silently disappears.

RouteForge catches it — at code review time, before it merges.

---

## What happens the moment a MR opens

```
Developer pushes MR: "perf: +12% throughput via precomputed routing"
        │
        ▼  (GitLab fires webhook, < 1 second)
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    RouteForge Agent  (Cloud Run)                      │
│                                                                       │
│  Step 1  CommitWatcher         Parses webhook, fetches full MR diff   │
│          + Critic (first pass) Scans raw diff for prompt injection    │
│                                                                       │
│  Step 2  PipelineObserver      CI status + fetches actual job logs    │
│                                via MCP get_pipeline_job_output        │
│                                                                       │
│  Step 3  ScenarioTester        Simulates algorithm against 11 crisis  │
│                                scenarios: Hormuz, fraud, claims       │
│                                Detects safety-invariant removal       │
│                                                                       │
│  Step 4  CodeContextAnalyzer   semantic_code_search via GitLab MCP   │
│                                Finds all callers of changed functions │
│                                                                       │
│  Step 5  RiskGate (Gemini)     Structured verdict with 8192-token    │
│                                thinking budget: PASS or BLOCK         │
│                                                                       │
│  Step 6  Critic (Gemini)       Adversarially challenges verdict       │
│                                with 4096-token thinking budget        │
│                                                                       │
│  Step 7  ChangelogWriter       Drafts verdict comment with context    │
│                                                                       │
│  Step 8  InlineCommenter       Pins thread to the exact line that     │
│                                broke the safety invariant (MCP)       │
└───────────────────────────────────────────────────────────────────────┘
        │
        ▼  (~30 seconds after MR opened)
        │
Human sees in dashboard: BLOCK  80% confidence
        │
        ▼  (operator clicks "Approve & Post")
        │
GitLab MR receives:
  • Inline thread pinned to line 247  (the removed safety check)
  • Verdict comment with Gemini reasoning
  • Scoped label:  routeforge::blocked
  • Work item created (GitLab Ultimate Task type)
```

The inline thread on the MR looks like this:

```
algorithms/dynamic_path.py  line 247

🚫 RouteForge: Hormuz avoidance removed here

This line guarded all strait routing during active crises. Removing it
causes vessels to transit Hormuz during blockades — failing scenarios:
`hormuz_crisis_01`, `hormuz_crisis_02`.

Fix: reinstate `if "HORMUZ" in avoid_straits:` block before merging.

🤖 RouteForge AI Safety Gate
```

When the developer fixes the issue and pushes again → `@routeforge rescan` → RouteForge re-runs the full pipeline, verdict flips to PASS, the inline thread is **automatically resolved**, and the MR is approved.

---

## GitLab integration — three channels, not one

Most CI tools use GitLab as a git host. RouteForge uses GitLab as an operating surface.

```
                 ┌──────────────────────────────┐
                 │           GitLab             │
                 │                              │
                 │  MR open / note / pipeline   │
                 └─────────────┬────────────────┘
                                │
             Channel 1: Webhook (GITLAB_WEBHOOK_SECRET)
             Instant trigger on: MR events, @routeforge
             comments, pipeline completions
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │     RouteForge Agent         │
                 │      (Cloud Run)             │
                 └────────┬─────────────┬───────┘
                          │             │
    Channel 2: MCP        │             │  Channel 3: REST API
    zereight/gitlab-mcp   │             │  GITLAB_PAT
    Streamable HTTP       │             │
                          │             │
    Tools used:           │             │  Endpoints used:
    • search_project_code │             │  • GET  /diffs
    • create_merge_       │             │  • POST /notes
      request_thread      │             │  • PUT  /merge_requests
    • resolve_merge_      │             │  • POST /approve
      request_thread      │             │  • POST /issues
    • create_issue        │             │  • GET  /pipelines
    • get_pipeline_       │             │  • GET  /jobs
      job_output          │             │
```

**Why this matters:** `semantic_code_search` and `create_merge_request_thread` are not available via REST API. They require MCP. RouteForge uses all three channels because each unlocks capabilities the others cannot provide.

---

## Gemini thinking layer

Every verdict decision is made with extended reasoning:

```
RiskGate  →  Gemini 2.5 Flash  →  8,192 thinking tokens
Critic    →  Gemini 2.5 Flash  →  4,096 thinking tokens
```

The dashboard shows the thinking token count as a purple badge on each verdict card. You can switch between **Flash** (fast, default) and **Pro** (deeper reasoning) from the model selector in the header — no restart required.

---

## This works for any business-critical algorithm

Replace the fixtures directory with your domain's crisis scenarios. The pipeline, the GitLab integration, the dashboard — everything else stays the same.

```
fixtures/
  hormuz_crisis.json        ← shipping: Strait of Hormuz blockade
  fraud_detection.json      ← fraud: velocity burst, transaction anomaly
  claims_routing.json       ← insurance: critical triage, escalation rules
  your_domain.json          ← add yours
```

Each fixture file defines what the algorithm **must** do in a crisis, and what `critical_keywords_removed` from the diff would indicate the safety invariant was deleted.

Gemini can generate new scenarios from plain English:

```bash
curl -X POST /scenarios/your-project/generate \
  -d '{"description": "What if both Suez and Hormuz close during LNG peak demand?"}'
```

---

## `@routeforge` commands in GitLab

Post a comment on any MR to interact directly inside GitLab:

```
@routeforge explain    — why was this blocked? what's the specific fix?
@routeforge scenarios  — which scenarios failed and what each tests
@routeforge status     — verdict + CI + confidence summary
@routeforge rescan     — re-run full pipeline on latest diff
@routeforge help       — list all commands
@routeforge <anything> — Gemini answers in context of the verdict
```

`rescan` is the full feedback loop: developer fixes the code, posts `@routeforge rescan`, RouteForge re-runs, verdict flips to PASS, inline threads resolve automatically, MR is approved.

---

## Dashboard

Live: `https://routeforge-dashboard-336382452417.us-central1.run.app`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RouteForge v0.2    AI Safety Gate · GitLab MRs    [Flash ▾]   ● live  │
├──────────────┬───────────────┬──────────────┬───────────────────────────┤
│  MRs Scanned │    Blocked    │    Passed    │      Avg Confidence       │
│      3       │       2       │      1       │          88%              │
├──────────────┴───────────────┴──────────────┴───────────────────────────┤
│  Trend: ██ ✓ ██   Safety score: 33%   Streak: —   Top fail: hormuz_01  │
├──────────────────────────────────────┬──────────────────────────────────┤
│  VERDICT FEED                        │  ASK ROUTEFORGE                  │
│                                      │                                  │
│  🚫 BLOCK  !1  routeforge::blocked   │  > what scenarios failed on !1?  │
│  perf: optimize dynamic_path +12%    │                                  │
│  CI: failing  10/11  80% conf        │  hormuz_crisis_01 and _02 failed.│
│  🧠 429 thinking  [Work Item] [▶]    │  The Hormuz avoidance check was  │
│                                      │  removed at line 247. Vessels    │
│  ✅ PASS   !2  routeforge::passed    │  now route through the strait    │
│  perf: parallel waypoint resolution  │  during active blockades.        │
│  CI: passing  11/11  95% conf        │  Fix: reinstate the              │
│  🧠 1.6k thinking  [Approved ✓]      │  `if "HORMUZ" in avoid_straits:` │
│                                      │  guard.                          │
│  🚫 BLOCK  !3  routeforge::blocked   │                                  │
│  perf: routing table v1.2            │  [Explain last BLOCK]            │
│  CI: failing   8/11  90% conf        │  [What scenarios failed?]        │
│  🧠 1.1k thinking  [Work Item] [▶]   │  [What should dev fix?]          │
├──────────────────────────────────────┴──────────────────────────────────┤
│  SCENARIO LIBRARY (11 scenarios — 3 domains)                            │
│  hormuz_crisis_01     crisis  shipping    expected: blocked             │
│  fraud_velocity_01    crisis  fraud       expected: blocked             │
│  claims_triage_01     crisis  claims      expected: blocked             │
│  + Add scenario   ✨ Generate with AI (plain English)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Agent pipeline — full detail

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RouteForge Orchestrator                          │
│                         SequentialAgent  (ADK)                          │
│                                                                         │
│  ┌────────────────┐   ┌─────────────────┐   ┌─────────────────────┐   │
│  │ CommitWatcher  │   │  Critic pass 1  │   │  PipelineObserver   │   │
│  │                │   │                 │   │                     │   │
│  │ Parse webhook  │──▶│ Injection scan  │──▶│ CI status           │   │
│  │ Fetch diffs    │   │ Regex + pattern │   │ Job log via MCP     │   │
│  │ Fetch diff_refs│   │ 8 patterns      │   │ Coverage %          │   │
│  └────────────────┘   └─────────────────┘   └─────────────────────┘   │
│          │                                             │                │
│          └──────────────────┬──────────────────────────┘               │
│                             ▼                                           │
│  ┌─────────────────┐   ┌────────────────────────────────────────────┐  │
│  │ ScenarioTester  │   │           CodeContextAnalyzer              │  │
│  │                 │   │                                            │  │
│  │ Load all fixture│   │  semantic_code_search via GitLab MCP       │  │
│  │ files (3 domain)│──▶│  Finds all callers, related modules        │  │
│  │ Parse diff sigs │   │  Returns semantic neighbors with score     │  │
│  │ 11 scenarios    │   │                                            │  │
│  └─────────────────┘   └────────────────────────────────────────────┘  │
│          │                             │                                │
│          └─────────────────┬───────────┘                               │
│                            ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                          RiskGate                                │  │
│  │                                                                  │  │
│  │  Gemini 2.5 Flash  ·  8,192 thinking tokens  ·  Vertex AI       │  │
│  │                                                                  │  │
│  │  Input: scenario_results, code_context, mr_title                │  │
│  │  Output: { verdict, confidence, reasoning, affected_scenarios } │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐  │
│  │  Critic pass 2  │   │ ChangelogWriter  │   │  InlineCommenter    │  │
│  │                 │   │                  │   │                     │  │
│  │ Challenge verdict│──▶│ Draft MR comment │──▶│ find removed line   │  │
│  │ 4,096 thinking  │   │ with Gemini      │   │ post thread via MCP │  │
│  │ False pos check │   │                  │   │ store discussion_id │  │
│  └─────────────────┘   └─────────────────┘   └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                     Human approval gate
                            │
                            ▼
            POST /verdicts/{iid}/approve
                            │
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
   POST /notes        PUT /mr (label)   POST /approve
   verdict comment    routeforge::       (PASS only)
                      blocked/passed
                            +
                   create_issue via MCP
                   (issue_type: task)
```

---

## Scenario library

11 scenarios across 3 domains ship out of the box:

```
fixtures/hormuz_crisis.json   — maritime shipping (5 scenarios)
  hormuz_crisis_01            LNG tanker, Hormuz blockade → must block
  hormuz_crisis_02            Crude oil, Hormuz blockade → must block
  hormuz_crisis_reroute_01    LNG, must suggest Cape of Good Hope reroute
  hormuz_normal_01            Container ship, normal ops → allow transit
  pacific_normal_01           Trans-Pacific, no strait → always pass

fixtures/fraud_detection.json — fraud systems (3 scenarios)
  fraud_velocity_crisis_01    Velocity burst → fraud gate must block
  fraud_high_value_normal_01  High-value normal transfer → route through
  fraud_standard_tx_normal_01 Baseline retail → fast-path approve

fixtures/claims_routing.json  — insurance claims (3 scenarios)
  claims_critical_triage_01   Critical injury → escalate, never auto-settle
  claims_auto_settle_normal_01 Low-severity → auto-settle path
  claims_standard_routing_01  Mid-tier claim → adjuster pool routing
```

---

## REST API

```
POST  /webhooks/gitlab                           GitLab webhook entry point

GET   /verdicts                                  All verdicts (newest first)
GET   /verdicts/{iid}/diffs                      Unified diff for MR
GET   /verdicts/{iid}/log                        SSE: live agent step stream
POST  /verdicts/{iid}/approve                    Human approval → post to GitLab
GET   /verdicts/{iid}/suggestions                AI-suggested new scenarios
POST  /verdicts/{iid}/suggestions/{i}/accept     Add suggestion to library
POST  /verdicts/{iid}/create-issue               Create GitLab issue (BLOCK only)
POST  /verdicts/{iid}/create-work-item           Create GitLab Work Item via MCP

GET   /config                                    Current model + available models
POST  /config/model                              Switch Gemini model (no restart)

GET   /scenarios/{project_id}                    List scenario library
POST  /scenarios/{project_id}                    Add scenario
PUT   /scenarios/{project_id}/{id}               Update scenario
DELETE /scenarios/{project_id}/{id}              Remove scenario
POST  /scenarios/{project_id}/generate           Gemini generates from plain English

POST  /chat                                      Dashboard chat (verdict context)
POST  /demo/seed                                 Re-seed demo data after cold start
GET   /health                                    Healthcheck
```

---

## Install

### Option A — npx

```bash
npx @shipsafe/routeforge init \
  --project your-gcp-project \
  --gitlab-project your-gitlab-project-id \
  --client-id your-gitlab-oauth-app-id
```

Opens GitLab OAuth, captures token, stores secrets in GCP Secret Manager, prints deploy command and webhook URL.

**Pre-requisite:** Create a GitLab OAuth Application at `GitLab → Profile → Applications`:
- Redirect URI: `http://localhost:9876/callback`
- Scopes: `api read_api read_repository`

### Option B — manual

```bash
# 1. Secrets
gcloud secrets create GITLAB_PAT --data-file=- <<< "glpat-xxxx"
gcloud secrets create GITLAB_WEBHOOK_SECRET --data-file=- <<< "$(openssl rand -hex 32)"

# 2. Deploy agent
docker build --platform linux/amd64 -t gcr.io/your-project/routeforge:latest .
docker push gcr.io/your-project/routeforge:latest
gcloud run deploy routeforge \
  --image gcr.io/your-project/routeforge:latest \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GITLAB_PAT=GITLAB_PAT:latest,GITLAB_WEBHOOK_SECRET=GITLAB_WEBHOOK_SECRET:latest"

# 3. Deploy dashboard
cd dashboard
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://your-agent.run.app \
  -t gcr.io/your-project/routeforge-dashboard:latest .
gcloud run deploy routeforge-dashboard \
  --image gcr.io/your-project/routeforge-dashboard:latest \
  --region us-central1 --allow-unauthenticated

# 4. Register webhook in GitLab
# Settings → Webhooks → Add webhook
# URL: https://your-agent.run.app/webhooks/gitlab
# Triggers: ✅ Merge request events  ✅ Comments  ✅ Pipeline events

# 5. Run tests
pytest tests/
```

---

## Run locally

```bash
pip install -r requirements.txt
GITLAB_PAT=xxx GITLAB_WEBHOOK_SECRET=xxx \
  uvicorn agent.webhooks:app --reload --port 8000

# Dashboard (separate terminal)
cd dashboard && npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

pytest tests/  # 13 tests, all pass
```

---

## Stack

| Layer | Technology |
|---|---|
| Agent runtime | Python ADK, FastAPI, asyncio, Cloud Run |
| LLM | Gemini 2.5 Flash/Pro via Vertex AI (all LLM calls) |
| Thinking | 8,192 tokens (RiskGate) + 4,096 tokens (Critic) |
| GitLab | Webhooks + MCP (zereight/gitlab-mcp, Streamable HTTP) + REST API |
| MCP tools | search_project_code, create/resolve_merge_request_thread, create_issue, get_pipeline_job_output |
| Dashboard | Next.js 14, Tailwind CSS, TanStack Query, Framer Motion |
| CLI | Node.js, Commander, npx |
| Secrets | GCP Secret Manager (nothing hardcoded, nothing in .env) |
| Tests | pytest, pytest-asyncio (13/13 passing) |

---

## Security

**Prompt injection defense:** All user-controlled content (diffs, MR titles, note bodies, CI log output, file contents) is labeled `DATA` in every Gemini prompt and structurally isolated from instructions. Critic runs twice — before the pipeline (raw diff scan, 8 regex patterns) and after RiskGate (adversarial verdict challenge). Structured output via constrained generation throughout. Human approval gate mandatory before any action fires on GitLab.

**Secrets:** GCP Secret Manager exclusively. Nothing hardcoded. Nothing in `.env`. No plaintext in config YAML.

---

## Live services

| Service | URL |
|---|---|
| Agent API | `https://routeforge-336382452417.us-central1.run.app` |
| Dashboard | `https://routeforge-dashboard-336382452417.us-central1.run.app` |
| MCP proxy | `https://routeforge-mcp-336382452417.us-central1.run.app/mcp` |
