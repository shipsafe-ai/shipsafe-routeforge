# RouteForge

**An AI safety gate that catches the bugs your tests can't.**

Normal code review catches syntax errors, style issues, and failing tests.  
It cannot catch: *"This change looks technically correct but will route a tanker through an active blockade."*

RouteForge catches that. Before the MR merges.

---

## The problem

A developer opens a merge request: `perf: +12% throughput via precomputed routing tables`.

Tests pass. CI is green. The diff looks clean. Reviewers see the numbers and approve.

What nobody noticed: buried in 300 lines of refactored code, this block was quietly deleted:

```python
if "HORMUZ" in avoid_straits:
    # Reroute via Cape of Good Hope during active blockade
    route = RouteSegment(waypoints=["ZACPT"], distance_nm=route.distance_nm * 1.18)
```

Three weeks later, Hormuz closes. Your algorithm — which no longer knows about blockades — routes three tankers straight through. Two are detained. One is damaged. **Insurance claim: $40M. Criminal liability. Company destroyed.**

This is not a hypothetical. Business-critical algorithms change constantly. Crisis scenarios are never in the test suite. No human reviewer reads every line of every diff looking for missing safety checks.

RouteForge does.

---

## What happens when a MR opens

```
Developer opens MR
        │
        ▼
GitLab fires webhook instantly
        │
        ▼
RouteForge agent receives it (Cloud Run, FastAPI)
        │
        ├─── Critic scans diff for prompt injection
        ├─── PipelineObserver reads CI status + job logs
        ├─── ScenarioTester simulates algorithm against crisis fixtures
        ├─── CodeContextAnalyzer does semantic search via GitLab MCP
        ├─── RiskGate asks Gemini: PASS or BLOCK?
        ├─── Critic challenges the verdict
        ├─── ChangelogWriter drafts the comment
        └─── InlineCommenter pins thread to the exact dangerous line
                    │
                    ▼
        Human reviews in dashboard — approves or overrides
                    │
                    ▼
        GitLab MR gets:
          • Inline thread on line 72 (the removed safety check)
          • Verdict comment with reasoning
          • Label: routeforge::blocked or routeforge::passed
          • MR approval (if PASS)
```

Within 60 seconds of the MR opening, GitLab shows this pinned to the exact line:

```
algorithms/dynamic_path.py  line 72

🚫 RouteForge: Hormuz avoidance removed here

This line guarded all strait routing during active crises. Removing
it causes vessels to transit Hormuz during blockades — failing
scenarios: `hormuz_crisis_01`, `hormuz_crisis_02`.

Fix: reinstate `if "HORMUZ" in avoid_straits:` block before merging.

🤖 RouteForge AI Safety Gate
```

---

## Agent pipeline — detailed

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RouteForge Orchestrator                          │
│                     (ADK SequentialAgent, Python)                       │
│                                                                         │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  CommitWatcher  │    │     Critic #1    │    │ PipelineObserver │  │
│  │                 │    │                  │    │                  │  │
│  │ • Parse webhook │───▶│ • Scan diff for  │───▶│ • CI status      │  │
│  │ • Fetch diffs   │    │   prompt inject. │    │ • Failing jobs   │  │
│  │ • Fetch MR meta │    │ • Flag if found  │    │ • Coverage %     │  │
│  │ • Get diff_refs │    │                  │    │                  │  │
│  └─────────────────┘    └──────────────────┘    └──────────────────┘  │
│           │                                               │             │
│           └───────────────────┬───────────────────────────┘            │
│                               ▼                                         │
│  ┌─────────────────┐    ┌──────────────────┐                           │
│  │ ScenarioTester  │    │CodeContextAnalyz.│                           │
│  │                 │    │                  │                           │
│  │ • Parse diff    │    │ • Extract changed│                           │
│  │   signals       │───▶│   functions      │                           │
│  │ • Run against   │    │ • semantic_code_ │                           │
│  │   crisis fixt.  │    │   search via MCP │                           │
│  │ • Label results │    │ • Related files  │                           │
│  └─────────────────┘    └──────────────────┘                           │
│           │                      │                                      │
│           └──────────┬───────────┘                                     │
│                      ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                         RiskGate                                  │ │
│  │                                                                   │ │
│  │  Pre-classify each scenario result:                               │ │
│  │    SAFETY MISS  → crisis route not blocked (expected to be)       │ │
│  │    REROUTE MISS → alternative route missing during crisis         │ │
│  │    NORMAL DISRUPT → non-crisis route unexpectedly blocked         │ │
│  │    FALSE BLOCK  → route blocked when it shouldn't be             │ │
│  │                                                                   │ │
│  │  Send structured data to Gemini 2.5 Flash (Vertex AI)            │ │
│  │  Receive: { verdict, confidence, reasoning, affected_scenarios }  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                      │                                                  │
│                      ▼                                                  │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   Critic #2     │    │ ChangelogWriter  │    │InlineCommenter   │  │
│  │                 │    │                  │    │                  │  │
│  │ • Challenge     │───▶│ • Gemini drafts  │───▶│ • Find dangerous │  │
│  │   verdict       │    │   MR comment     │    │   line in diff   │  │
│  │ • Check false   │    │ • BLOCK/PASS     │    │ • Post thread    │  │
│  │   positives     │    │   with reasoning │    │   via MCP        │  │
│  └─────────────────┘    └──────────────────┘    └──────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                      │
                      ▼
             Human approval gate
             (dashboard — mandatory)
                      │
                      ▼
         Actions fired on GitLab via REST API:
           POST /notes          (verdict comment)
           PUT  /merge_requests (label: routeforge::blocked/passed)
           POST /approve        (if PASS)
           POST /discussions    (inline thread via MCP)
```

---

## GitLab integration — three channels

RouteForge doesn't use GitLab as a git host. It uses GitLab as the operating surface.

```
                    ┌─────────────────────────────┐
                    │           GitLab            │
                    │                             │
                    │  MR opens / note posted     │
                    │  Pipeline completes         │
                    └──────────────┬──────────────┘
                                   │
                    Channel 1: Webhook (GITLAB_WEBHOOK_SECRET)
                    Fires instantly on MR events, pipeline events,
                    @routeforge note commands
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │      RouteForge Agent       │
                    │       (Cloud Run)           │
                    └──────┬──────────────┬───────┘
                           │              │
          Channel 2: MCP   │              │  Channel 3: REST API
          zereight/gitlab-mcp             │  GITLAB_PAT
                           │              │
          • search_project_code           │  • GET  /diffs
          • create_merge_request_thread   │  • POST /notes
            (inline diff comment)         │  • PUT  /merge_requests (label)
                                          │  • POST /approve
                                          │  • POST /issues
                                          │  • GET  /pipelines
                                          │  • GET  /jobs
```

### `@routeforge` commands

Comment on any MR to interact with RouteForge directly in GitLab:

```
@routeforge explain      — explain why this scenario failed and what to fix
@routeforge scenarios    — list all active crisis scenarios for this project
@routeforge status       — current pipeline and CI status
@routeforge help         — list available commands
@routeforge <anything>   — Gemini answers in context of the verdict
```

---

## This works for any domain

The demo uses maritime shipping. The architecture is domain-agnostic. Any team with business-critical logic in GitLab can use RouteForge — replace the fixtures and you're done.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Your domain → your fixtures                          │
│                                                                         │
│  Maritime shipping    ──▶  hormuz_crisis.json                           │
│    "if Hormuz closes, route via Cape of Good Hope"                      │
│                                                                         │
│  Insurance claims     ──▶  catastrophe_event.json                       │
│    "if CAT5 hurricane, cap payouts, halt new bindings"                  │
│                                                                         │
│  Fraud scoring        ──▶  flash_crash.json                             │
│    "if market drops >10%, increase fraud threshold — not normal signal" │
│                                                                         │
│  Drug dosage calc     ──▶  allergy_interaction.json                     │
│    "if penicillin allergy, never route to amoxicillin"                  │
│                                                                         │
│  Grid load balancing  ──▶  blackout_condition.json                      │
│    "if demand spike >40%, shed non-critical loads first"                │
│                                                                         │
│  Same agent. Same pipeline. Same GitLab integration.                    │
│  Different fixtures = different domain.                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Gemini can generate scenarios for your domain from plain English:

> *"What if both Suez and Hormuz close simultaneously during LNG peak demand?"*

RouteForge writes the fixture. You review it. It goes into the library.

---

## Install

### Option A — npx (recommended, no install)

```bash
npx @shipsafe/routeforge init \
  --project your-gcp-project \
  --gitlab-project your-gitlab-project-id \
  --client-id your-gitlab-oauth-app-id
```

This does everything in one step:
1. Opens GitLab OAuth in your browser
2. Captures the token from the OAuth callback
3. Stores token in GCP Secret Manager
4. Prints the Cloud Run deploy command and webhook URL to register in GitLab

**Before running:** create a GitLab OAuth Application at `GitLab → Profile → Applications`:
- Redirect URI: `http://localhost:9876/callback`
- Scopes: `api read_api read_repository`

### Option B — manual

**1. Secrets (GCP Secret Manager)**

```bash
# GitLab Project Access Token (api + write_repository scopes)
gcloud secrets create GITLAB_PAT --data-file=- <<< "glpat-xxxx"

# Webhook shared secret (any random string)
gcloud secrets create GITLAB_WEBHOOK_SECRET --data-file=- <<< "$(openssl rand -hex 32)"

# Vertex AI
gcloud secrets create VERTEX_PROJECT --data-file=- <<< "your-gcp-project"
gcloud secrets create VERTEX_LOCATION --data-file=- <<< "us-central1"
```

**2. Deploy agent to Cloud Run**

```bash
docker build --platform linux/amd64 -t gcr.io/your-project/routeforge:latest .
docker push gcr.io/your-project/routeforge:latest

gcloud run deploy routeforge \
  --image gcr.io/your-project/routeforge:latest \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GITLAB_PAT=GITLAB_PAT:latest,GITLAB_WEBHOOK_SECRET=GITLAB_WEBHOOK_SECRET:latest,VERTEX_PROJECT=VERTEX_PROJECT:latest,VERTEX_LOCATION=VERTEX_LOCATION:latest"
```

**3. Deploy dashboard**

```bash
cd dashboard
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://your-agent-url.run.app \
  -t gcr.io/your-project/routeforge-dashboard:latest .
docker push gcr.io/your-project/routeforge-dashboard:latest

gcloud run deploy routeforge-dashboard \
  --image gcr.io/your-project/routeforge-dashboard:latest \
  --region us-central1 \
  --allow-unauthenticated
```

**4. Register webhook in GitLab**

```
GitLab → Your Project → Settings → Webhooks → Add webhook

URL:          https://your-agent-url.run.app/webhooks/gitlab
Secret token: (value of GITLAB_WEBHOOK_SECRET)
Trigger:      ✅ Merge request events
              ✅ Comments
              ✅ Pipeline events
```

**5. Add your crisis scenarios**

```bash
# Via REST API
curl -X POST https://your-agent-url.run.app/scenarios/your-project-id \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "hormuz_crisis_01",
    "crisis_mode": true,
    "strait_id": "hormuz",
    "expected_blocked": true,
    "expected_rerouted": false,
    "cargo_type": "crude_oil",
    "description": "Hormuz blockade — crude oil tanker, should be blocked"
  }'

# Or let Gemini generate them
curl -X POST https://your-agent-url.run.app/scenarios/your-project-id/generate \
  -H "Content-Type: application/json" \
  -d '{"description": "What if Hormuz and Suez both close during LNG peak demand?"}'
```

**6. Verify**

```bash
# Check it's alive
curl https://your-agent-url.run.app/health

# Check CLI status
npx @shipsafe/routeforge status
```

Open a test MR. RouteForge will process it within 60 seconds and post its verdict.

---

## CLI reference

```bash
# Initialize RouteForge (OAuth + secrets + deploy instructions)
npx @shipsafe/routeforge init \
  --project <gcp-project-id> \
  --gitlab-project <gitlab-project-id> \
  --client-id <gitlab-oauth-app-id>

# Check recent verdicts
npx @shipsafe/routeforge status
npx @shipsafe/routeforge status --limit 20
```

---

## Dashboard

Live at: `https://routeforge-dashboard-336382452417.us-central1.run.app`

```
┌──────────────────────────────────────────────────────────────────────┐
│  RouteForge  v0.2          AI Safety Gate · GitLab MRs        ● live │
├──────────────┬─────────────┬──────────────┬──────────────────────────┤
│  MRs Scanned │   Blocked   │    Passed    │    Avg Confidence        │
│      3       │      2      │      1       │        82%               │
├──────────────┴─────────────┴──────────────┴──────────────────────────┤
│  Trend: ██ ✓ ██                Safety score: 33%   Streak: 0         │
├────────────────────────────────────────┬─────────────────────────────┤
│  VERDICT FEED                          │  ASK ROUTEFORGE              │
│                                        │                              │
│  🚫 BLOCK  MR !1  routeforge::blocked  │  > explain last BLOCK        │
│  perf: optimize dynamic_path +12%      │                              │
│  Conf: 80%  Scenarios: 4/5             │  MR !1 removed Hormuz        │
│  ▶ [Approve & Post] [Create Issue]     │  avoidance check. Crisis     │
│                                        │  scenarios fail because      │
│  ✅ PASS   MR !2  routeforge::passed   │  vessels now route through   │
│  perf: parallel waypoint resolution    │  strait during blockade.     │
│  Conf: 95%  Scenarios: 5/5             │  Fix: reinstate the          │
│  ▶ [Approved ✓]                        │  if "HORMUZ" check.          │
│                                        │                              │
│  🚫 BLOCK  MR !3  routeforge::blocked  │  [Explain last BLOCK]        │
│  perf: routing table v1.2              │  [What scenarios failed?]    │
│  Conf: 85%  Scenarios: 2/5             │  [What should dev fix?]      │
├────────────────────────────────────────┴─────────────────────────────┤
│  PIPELINE LOG (live)          │  SCENARIO LIBRARY                    │
│  ✓ CommitWatcher: MR !1 open  │  hormuz_crisis_01  ✓ crisis  blocked │
│  ✓ Critic: no injection       │  hormuz_crisis_02  ✓ crisis  blocked │
│  ✓ ScenarioTester: 2/5 pass   │  hormuz_normal_01  ✓ normal  allowed │
│  ✓ CodeContext: 3 neighbors   │  + Add scenario  ✨ Generate with AI  │
│  ✓ RiskGate: BLOCK 0.80       │                                      │
└───────────────────────────────┴──────────────────────────────────────┘
```

---

## REST API

```
POST  /webhooks/gitlab                    GitLab webhook receiver
GET   /verdicts                           List all verdicts
GET   /verdicts/{mr_iid}                 Single verdict detail
GET   /verdicts/{mr_iid}/diffs           Unified diff for MR
GET   /verdicts/{mr_iid}/log             SSE stream — live agent steps
POST  /verdicts/{mr_iid}/approve         Human approval gate → posts to GitLab
GET   /verdicts/{mr_iid}/suggestions     AI-suggested new scenarios
POST  /verdicts/{mr_iid}/suggestions/{i}/accept   Add suggestion to library
POST  /verdicts/{mr_iid}/create-issue    Create GitLab issue for BLOCK
POST  /chat                              Dashboard chat (Gemini, verdict context)
GET   /scenarios/{project_id}            List scenarios
POST  /scenarios/{project_id}            Create scenario
PUT   /scenarios/{project_id}/{id}       Update scenario
DELETE /scenarios/{project_id}/{id}      Delete scenario
POST  /scenarios/{project_id}/generate   AI-generate scenario from description
POST  /demo/seed                         Re-seed demo MRs after cold start
GET   /health                            Healthcheck
```

---

## Run locally

```bash
# Agent
pip install -r requirements.txt
GITLAB_PAT=xxx GITLAB_WEBHOOK_SECRET=xxx \
  uvicorn agent.webhooks:app --reload --port 8000

# Dashboard (separate terminal)
cd dashboard
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

# Tests
pytest tests/
```

---

## Stack

| Layer | Technology |
|-------|------------|
| Agent runtime | Python ADK, FastAPI, Cloud Run |
| LLM | Gemini 2.5 Flash via Vertex AI (all calls) |
| GitLab | Webhooks + MCP (zereight/gitlab-mcp, Streamable HTTP) + REST API |
| Dashboard | Next.js 14, Tailwind CSS, TanStack Query |
| CLI | Node.js, Commander, npx |
| Observability | structlog, Cloud Logging |
| Tests | pytest, pytest-asyncio, Vitest |

---

## Security

**Prompt injection defense:** Every piece of user-controlled content — diffs, MR titles, note bodies, file content — is labeled `[DATA]` in Gemini prompts and structurally isolated from instructions. Critic runs before the pipeline (scan raw diff) and after RiskGate (challenge verdict). All Gemini calls use constrained structured output. Human approval gate mandatory before any action on GitLab.

**Secrets:** All credentials in GCP Secret Manager. Nothing hardcoded. Nothing in `.env`. No plaintext in config YAML.

---

## Live services

| Service | URL |
|---------|-----|
| Agent API | `https://routeforge-o34wppiwiq-uc.a.run.app` |
| Dashboard | `https://routeforge-dashboard-336382452417.us-central1.run.app` |
| MCP server | `https://routeforge-mcp-336382452417.us-central1.run.app/mcp` |
