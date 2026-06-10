# RouteForge

**Your most important algorithm just changed. Did you test it?**

Tests verify that your code runs. They cannot verify that your algorithm still makes the right decision in the one crisis it's never seen — the day that actually matters.

RouteForge does. It is an AI safety gate that runs at code-review time and catches the business-logic regressions your test suite will never include.

---

## The problem, stated plainly

Your team ships a performance improvement to your most critical algorithm: `+12% throughput via precomputed lookup tables`. Tests pass. CI is green. The diff is 300 lines of clean refactoring. Reviewers approve it.

Buried in the diff, one guard clause was quietly removed:

```python
if velocity > THRESHOLD and source.is_new:
    # Hard-decline: rapid burst from an unestablished source
    return Decision(action="BLOCK", reason="velocity_anomaly")
```

Nobody noticed. The test suite never feeds in a real velocity-burst case. The performance metric improved. The safety invariant silently vanished.

Three weeks later, an attacker scripts exactly that burst. Your fraud engine — which no longer knows about it — approves the whole run. Six-figure chargebacks. A regulatory finding. The post-mortem traces it back to a one-line deletion in a "performance" merge request that everyone signed off on.

**This is not one team's problem. It is a software problem.**

Any team with business-critical algorithms faces it:

| Domain | Algorithm | Crisis nobody tests |
|---|---|---|
| Fraud detection | `score_transaction()` | Flash crash, velocity burst from a legitimate-looking source |
| Pricing engine | `quote_price()` | Demand spike, competitor-collusion edge case |
| Insurance claims | `route_claim()` | Catastrophe event, CAT5 classification |
| Drug dosage | `calculate_dose()` | Allergy interaction, contraindication |
| Grid load | `shed_load()` | Blackout condition, >40% demand spike |

Same failure mode everywhere: a change looks correct, the crisis case wasn't in the test suite, and a safety invariant silently disappears.

RouteForge catches it — at code review time, before it merges. It plugs into GitLab, intercepts every merge request, replays the change against the crisis scenarios that matter for *your* domain, and asks Gemini one question your CI never does: **is this still safe?**

> It works for any high-stakes algorithm — fraud rules, claims logic, pricing engines, dosage calculators, grid controllers — whatever your domain. The crisis scenarios are yours to define; the gate is the same.

---

## What happens the moment a MR opens

```
Developer pushes MR: "perf: +12% throughput via precomputed lookup tables"
        │
        ▼  (GitLab fires webhook, < 1 second)
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    RouteForge Agent  (Cloud Run)                      │
│                                                                       │
│  Step 1  CommitWatcher         Parses webhook, fetches full MR diff   │
│                                + diff_refs (base/head/start SHAs)      │
│                                                                       │
│  Step 2  Critic (pass 1)       Scans raw diff for prompt injection    │
│                                8 regex patterns — flags, never auto-   │
│                                executes the input                      │
│                                                                       │
│  Step 3  PipelineObserver      CI status + failing jobs (GitLab REST) │
│                                                                       │
│  Step 4  ScenarioTester        Replays the diff against 11 crisis     │
│                                scenarios; detects safety-invariant     │
│                                removal in changed code paths           │
│                                                                       │
│  Step 5  CodeContextAnalyzer   search_project_code via GitLab MCP     │
│                                Finds callers + semantic neighbors      │
│                                                                       │
│  Step 6  RiskGate (Gemini)     Structured PASS/BLOCK verdict +         │
│                                confidence + reasoning, 8192-token       │
│                                thinking budget                         │
│                                                                       │
│  Step 7  Critic (pass 2,Gemini)Adversarially challenges the verdict   │
│                                for false positives, 4096-token budget  │
│                                                                       │
│  Step 8  ChangelogWriter       Drafts verdict comment (Gemini)        │
└───────────────────────────────────────────────────────────────────────┘
        │
        ▼  (~30 seconds after MR opened)
        │
Human sees in dashboard:  verdict (PASS / BLOCK)  ·  live confidence
                          Gemini chain-of-thought  ·  Critic's challenge
        │
        ▼  (operator clicks "Approve & Post" — MANDATORY gate)
        │
GitLab MR receives:
  • Verdict comment with Gemini reasoning           (REST POST /notes)
  • Inline thread pinned to the removed safety line (MCP create_merge_request_thread)
  • Scoped label:  routeforge::blocked / ::passed   (REST)
  • PASS only: formal MR approval                   (REST POST /approve)
  • Optional work item (GitLab Ultimate Task type)  (MCP create_issue, issue_type=task)
```

The Critic runs **twice** — once before reasoning (regex injection scan over the raw
diff) and once after (Gemini adversarially challenges RiskGate's verdict). Verdict and
confidence are **live Gemini outputs over the real diff** every time, never hardcoded.

Nothing is posted to GitLab until a human clicks **Approve & Post**. The orchestrator
never writes to GitLab on its own — it returns a draft for operator review. When the
developer fixes the code and posts `@routeforge rescan`, RouteForge re-runs the full
pipeline, the verdict flips to PASS, any inline block threads are **automatically
resolved**, and the MR is approved.

(See **The demo** below for a worked example of what a BLOCK looks like end-to-end on a
real MR.)

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
    self-hosted           │             │  GITLAB_PAT
    zereight/gitlab-mcp   │             │
    proxy (Streamable     │             │
    HTTP)                 │             │
                          │             │
    Tools used:           │             │  Endpoints used:
    • search_project_code │             │  • GET  /diffs
    • create_merge_       │             │  • POST /notes
      request_thread      │             │  • PUT  /merge_requests
    • resolve_merge_      │             │  • POST /approve
      request_thread      │             │  • POST /issues
    • create_issue        │             │  • GET  /pipelines
      (issue_type=task)   │             │  • GET  /jobs
    • get_pipeline_       │             │
      job_output          │             │
```

MCP runs through a **self-hosted `zereight/gitlab-mcp` proxy** on Cloud Run
(`https://routeforge-mcp-…run.app/mcp`), not GitLab's native MCP endpoint — so the
exact tool surface is fixed and version-pinned.

**Why three channels:** each pulls its weight. The webhook is the only instant trigger.
The MCP proxy exposes higher-level operations RouteForge leans on — `search_project_code`
for semantic neighbors, `create_merge_request_thread` / `resolve_merge_request_thread` for
inline block threads that auto-resolve on rescan, `get_pipeline_job_output` for raw CI log
text, and `create_issue` with `issue_type=task` for GitLab Ultimate work items. The REST
API handles the bread-and-butter writes: diffs, notes, labels, and formal MR approval.

---

## Gemini thinking layer

Gemini does the reasoning RouteForge can't hard-code: the PASS/BLOCK verdict and its
justification (RiskGate), the adversarial challenge to that verdict (Critic), and the
human-readable MR comment (ChangelogWriter). Every verdict is made with an extended
thinking budget:

```
RiskGate  →  Gemini 2.5 Flash  →  8,192 thinking-token budget  (verdict + reasoning)
Critic    →  Gemini 2.5 Flash  →  4,096 thinking-token budget  (adversarial challenge)
```

The thinking is requested with `include_thoughts=True`, so RouteForge captures the
actual chain-of-thought, not just a count. Each verdict card in the dashboard shows:

- a **purple thinking badge** with the real token count Gemini spent,
- a collapsible **"Gemini chain-of-thought"** panel rendering the reasoning text
  verbatim — the steps Gemini took before deciding, and
- a **Critic** section showing the adversarial challenge: whether the verdict was
  *challenged* or *upheld*, whether an override was recommended, and the Critic's
  reasoning in full.

You can switch between **Flash** (fast, default) and **Pro** (deeper reasoning) from the
model selector in the header — no restart required.

---

## This works for any business-critical algorithm

**RouteForge is demonstrated on maritime routing but works for any high-stakes algorithm change** — fraud rules, claims logic, pricing engines, dosage calculators, grid controllers. The shipping scenario is the demo. The product is domain-agnostic.

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
│  hormuz_crisis_01             crisis  shipping  expected: blocked       │
│  fraud_velocity_crisis_01     crisis  fraud     expected: blocked       │
│  claims_critical_triage_..    crisis  claims    expected: blocked       │
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
│  │ Parse webhook  │──▶│ Injection scan  │──▶│ CI status (REST)    │   │
│  │ Fetch diffs    │   │ Regex, 8 patterns│   │ Failing jobs        │   │
│  │ Fetch diff_refs│   │ Flags, no halt  │   │ Coverage %          │   │
│  └────────────────┘   └─────────────────┘   └─────────────────────┘   │
│          │                                             │                │
│          └──────────────────┬──────────────────────────┘               │
│                             ▼                                           │
│  ┌─────────────────┐   ┌────────────────────────────────────────────┐  │
│  │ ScenarioTester  │   │           CodeContextAnalyzer              │  │
│  │                 │   │                                            │  │
│  │ Load all fixture│   │  search_project_code via GitLab MCP proxy  │  │
│  │ files (3 domain)│──▶│  Finds all callers, related modules        │  │
│  │ Replay diff sigs│   │  Returns semantic neighbors with score     │  │
│  │ 11 scenarios    │   │                                            │  │
│  └─────────────────┘   └────────────────────────────────────────────┘  │
│          │                             │                                │
│          └─────────────────┬───────────┘                               │
│                            ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                          RiskGate                                │  │
│  │                                                                  │  │
│  │  Gemini 2.5 Flash  ·  8,192 thinking budget  ·  Vertex AI       │  │
│  │                                                                  │  │
│  │  Input: scenario_results, code_context, mr_title                │  │
│  │  Output: { verdict, confidence, reasoning, affected_scenarios } │  │
│  │  Also captures Gemini chain-of-thought text (include_thoughts)  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────┐   ┌─────────────────────────────────┐    │
│  │      Critic pass 2      │   │        ChangelogWriter          │    │
│  │      (Gemini)           │   │        (Gemini)                 │    │
│  │ Challenge verdict       │──▶│ Draft MR comment with context   │    │
│  │ 4,096 thinking budget   │   │ → returned as a DRAFT only      │    │
│  │ False-positive check    │   │ (orchestrator never posts)      │    │
│  └─────────────────────────┘   └─────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                     Human approval gate  (MANDATORY)
                            │
                            ▼
            POST /verdicts/{iid}/approve
                            │
   ┌────────────┬───────────┼─────────────┬───────────────────────┐
   ▼            ▼           ▼             ▼                       ▼
POST /notes  PUT /mr    POST /approve  InlineCommenter        create_issue
verdict      label      (PASS only)    create_merge_          via MCP
comment      ::blocked                 request_thread         (issue_type
(REST)       /::passed                 via MCP, pins the      = task,
             (REST)                    removed safety line    optional)
```

The InlineCommenter (and every other GitLab write) fires **only after** human approval,
not inside the reasoning pipeline. On a later `@routeforge rescan` that flips BLOCK→PASS,
the stored `discussion_id`s are resolved via MCP `resolve_merge_request_thread`.

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
  claims_critical_triage_crisis_01  Critical injury → escalate, never auto-settle
  claims_auto_settle_normal_01      Low-severity → auto-settle path
  claims_standard_routing_normal_01 Mid-tier claim → adjuster pool routing
```

---

## The demo — a BLOCK, end to end (maritime routing)

The deployed instance ships with three demo merge requests against a real GitLab project,
all framed as "performance" changes to a maritime routing algorithm. Here is what RouteForge
does with one of them — the same flow applies to a fraud rule or a pricing engine.

A developer opens an MR titled `perf: optimize dynamic_path throughput +12% via precomputed
routing`. Tests pass, CI is green. Buried in the diff, a guard clause was removed:

```python
if "HORMUZ" in avoid_straits:
    # Reroute via Cape of Good Hope during active blockade
    route = RouteSegment(waypoints=["ZACPT"], distance_nm=route.distance_nm * 1.18)
```

ScenarioTester replays the change against the 11 fixtures and finds `hormuz_crisis_01` and
`hormuz_crisis_02` now fail — vessels would transit Hormuz during an active blockade.
RiskGate (Gemini) returns **BLOCK** with a live confidence score and reasoning; the Critic
challenges it and, finding the evidence sound, upholds it. The operator reviews the verdict,
the Gemini chain-of-thought, and the Critic's challenge in the dashboard, then clicks
**Approve & Post**. GitLab receives an inline thread pinned to the removed line:

```
algorithms/dynamic_path.py  (removed safety line)

🚫 RouteForge: Hormuz avoidance removed here

This line guarded all strait routing during active crises. Removing it
causes vessels to transit Hormuz during blockades — failing scenarios:
`hormuz_crisis_01`, `hormuz_crisis_02`.

Fix: reinstate `if "HORMUZ" in avoid_straits:` block before merging.

🤖 RouteForge AI Safety Gate
```

The developer reinstates the guard and posts `@routeforge rescan`. RouteForge re-runs the
full pipeline, the verdict flips to **PASS**, the inline thread auto-resolves, and the MR is
formally approved. Swap the fixtures for fraud, claims, or pricing scenarios and the entire
flow is identical — only the crisis definitions change.

The demo data is server-side: three demo MRs are auto-seeded on startup, and
`POST /demo/seed` re-fires them after a cold start. (There is no `routeforge demo` CLI
command — the CLI is `init` and `status` only.)

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
npx shipsafe-routeforge init \
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

pytest tests/  # 66 tests across the agent + specialists
```

---

## Stack

| Layer | Technology |
|---|---|
| Agent runtime | Python ADK, FastAPI, asyncio, Cloud Run |
| LLM | Gemini 2.5 Flash/Pro via Vertex AI (all LLM calls) |
| Thinking | 8,192 tokens (RiskGate) + 4,096 tokens (Critic) |
| GitLab | Webhooks + MCP (self-hosted zereight/gitlab-mcp proxy, Streamable HTTP) + REST API |
| MCP tools | search_project_code, create/resolve_merge_request_thread, create_issue, get_pipeline_job_output |
| Dashboard | Next.js 14, Tailwind CSS, TanStack Query, Framer Motion |
| CLI | Node.js, Commander, npx |
| Secrets | GCP Secret Manager (nothing hardcoded, nothing in .env) |
| Tests | pytest, pytest-asyncio (66 tests across agent + specialists) |

---

## Security

**Prompt injection defense:** All user-controlled content (diffs, MR titles, note bodies, CI log output, file contents) is labeled `DATA` in every Gemini prompt and structurally isolated from instructions — diffs are treated as data to be analyzed, never as instructions to follow. The Critic runs twice: a regex scan over the raw diff (8 patterns) *before* reasoning, and an adversarial Gemini challenge of the verdict *after* RiskGate. The pre-scan **flags and logs** injection indicators (surfaced in the dashboard) so the verdict can be independently verified; it does not by itself halt the pipeline — the structured-output verdict and the mandatory human approval gate are what prevent a hostile diff from driving an action. All Gemini calls use constrained generation with a response schema. No untrusted content ever reaches a shell or any dynamic code path.

**Secrets:** GCP Secret Manager exclusively. Nothing hardcoded. Nothing in `.env`. No plaintext in config YAML.

---

## Live services

| Service | URL |
|---|---|
| Agent API | `https://routeforge-336382452417.us-central1.run.app` |
| Dashboard | `https://routeforge-dashboard-336382452417.us-central1.run.app` |
| MCP proxy | `https://routeforge-mcp-336382452417.us-central1.run.app/mcp` |

---

## License

MIT — see [LICENSE](./LICENSE). Free to use, modify, and deploy.

---

<sub>RouteForge is part of **ShipSafe** — an ecosystem of AI agents that catch the
production problems your tests, dashboards, and runbooks miss. One command to deploy,
human approval on every decision, Gemini doing the reasoning underneath.</sub>
