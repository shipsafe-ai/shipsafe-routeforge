# RouteForge — AI Safety Gate for GitLab MRs

RouteForge watches GitLab merge requests, runs changed algorithms against crisis scenario tests, and posts a pass/block verdict before the change reaches production.

**Demo domain:** maritime shipping routing. Universal value: any team with critical business logic in GitLab — fraud detection, pricing engines, claims routing, ranking models.

**Live services:**
- Agent API: `https://routeforge-o34wppiwiq-uc.a.run.app`
- Dashboard: `https://routeforge-dashboard-336382452417.us-central1.run.app`

---

## Architecture

```
GitLab MR webhook
       │
       ▼
  webhooks.py (FastAPI)
       │
       ▼
  orchestrator.py (ADK SequentialAgent)
  ┌─────────────────────────────────────────────────┐
  │  CommitWatcher → ScenarioTester → CodeContext   │
  │  Analyzer → PipelineObserver → RiskGate →      │
  │  ChangelogWriter → Critic                       │
  └─────────────────────────────────────────────────┘
       │
       ▼
  Verdict + comment posted to GitLab MR via PAT REST API
```

All LLM calls use **Gemini 2.5 Flash via Vertex AI**. No OpenAI, no Anthropic API.

---

## Agent Specialists

| Specialist | File | Job |
|---|---|---|
| CommitWatcher | `specialists/commit_watcher.py` | Parses webhook, fetches MR metadata + commits via GitLab REST |
| ScenarioTester | `specialists/scenario_tester.py` | Runs changed algorithm against crisis scenario fixtures |
| CodeContextAnalyzer | `specialists/code_context_analyzer.py` | Semantic code search via zereight/gitlab-mcp MCP server |
| PipelineObserver | `specialists/pipeline_observer.py` | Fetches CI pipeline status + failing jobs for MR |
| RiskGate | `specialists/risk_gate.py` | Pass/block verdict + calibrated confidence score via Gemini structured output |
| ChangelogWriter | `specialists/changelog_writer.py` | Drafts verdict comment body posted to MR |
| Critic | `critic.py` | Challenges verdict + checks for prompt injection in diff content |
| ChatHandler | `specialists/chat_handler.py` | Handles `@routeforge` MR commands + dashboard chat via Gemini |

**Orchestrator:** `orchestrator.py` (ADK SequentialAgent)
**Webhook handler:** `webhooks.py` (FastAPI, `/webhooks/gitlab`)

---

## GitLab Integration — Three Channels

| Channel | Auth | Purpose |
|---|---|---|
| Webhook | `GITLAB_WEBHOOK_SECRET` | Entry point — GitLab fires on MR + note events |
| MCP (zereight/gitlab-mcp) | `GITLAB_PAT` + `REMOTE_AUTHORIZATION` | AI-native semantic code search via Streamable HTTP |
| REST API | `GITLAB_PAT` | Read diffs, post comments, get pipeline status, create issues |

### `@routeforge` Commands (GitLab MR Notes)

Comment on any MR to interact with RouteForge:

```
@routeforge explain          — explain verdict + why this scenario fails
@routeforge scenarios        — list active crisis scenarios
@routeforge status           — current pipeline and CI status
@routeforge help             — list available commands
@routeforge <free text>      — Gemini answers in context of last verdict
```

---

## Dashboard

Next.js 14 dashboard at `/dashboard`. Components:

| Component | Description |
|---|---|
| `VerdictFeed` | Live-polling verdict cards with animated entrance, BLOCK/PASS badges, confidence meter, CI badge, issue button |
| `PipelineLog` | SSE-connected terminal log stream — shows agent steps in real time as MR processes |
| `DiffViewer` | Side-by-side unified diff viewer with line numbers + failing function highlighting |
| `ScenarioEditor` | Collapsible scenario library — add/edit/delete scenarios, Gemini auto-generate from description |
| `ChatPanel` | Chat with RouteForge AI in context of any MR verdict |
| `StatsBar` | Live stats: MRs scanned, blocked count, avg confidence |

---

## Scenario Library

Per-project crisis scenarios stored in `fixtures/scenarios_{project_id}.json`. Falls back to `fixtures/hormuz_crisis.json`.

**REST API:**
```
GET    /scenarios/{project_id}           — list scenarios
POST   /scenarios/{project_id}           — create scenario
PUT    /scenarios/{project_id}/{id}      — update scenario
DELETE /scenarios/{project_id}/{id}      — delete scenario
POST   /scenarios/{project_id}/generate  — Gemini auto-generate from description
```

Default scenarios include Hormuz blockade, Suez disruption, Malacca chokepoint, Panama Canal drought, LNG tanker diversions.

---

## REST API

```
POST   /webhooks/gitlab                  — GitLab webhook receiver
GET    /verdicts                         — list all verdicts
GET    /verdicts/{mr_iid}               — single verdict
GET    /verdicts/{mr_iid}/diffs         — unified diffs for MR
GET    /verdicts/{mr_iid}/log           — SSE stream of agent pipeline steps
POST   /verdicts/{mr_iid}/approve       — human approval gate → posts to GitLab
POST   /verdicts/{mr_iid}/create-issue  — creates GitLab issue for BLOCK verdict
POST   /chat                            — dashboard chat (Gemini, verdict context)
GET    /health                          — healthcheck
```

---

## Confidence Calibration

RiskGate pre-classifies each scenario result before sending to Gemini:

| Label | Condition |
|---|---|
| `SAFETY MISS` | `crisis_mode=True` AND route not blocked AND `expected_blocked=True` |
| `REROUTE MISS` | `expected_rerouted=True` AND route not rerouted |
| `NORMAL DISRUPTION` | `not crisis_mode` AND route blocked (algorithm over-aggressive) |
| `FALSE BLOCK` | `crisis_mode=True` AND `expected_blocked=False` AND blocked |

Confidence scale: 0.85–1.0 (multiple clear failures) → 0.10–0.40 (sparse data).

---

## Secrets (GCP Secret Manager)

| Secret | Purpose |
|---|---|
| `GITLAB_PAT` | Project Access Token — api + write_repository scopes |
| `GITLAB_WEBHOOK_SECRET` | Webhook signature verification |
| `GITLAB_MCP_OAUTH_TOKEN` | zereight/gitlab-mcp auth |
| `VERTEX_PROJECT` | GCP project for Vertex AI |
| `VERTEX_LOCATION` | Vertex AI region |

Nothing hardcoded. Nothing in `.env` files.

---

## Tests

```bash
pytest tests/                        # all tests
pytest tests/specialists/            # specialist unit tests
```

9 test files covering all specialists + webhooks + critic. TDD — test files written before implementation.

---

## Deploy

**Agent:**
```bash
docker build --platform linux/amd64 -t us-central1-docker.pkg.dev/shipsafe-ai/routeforge/agent:latest .
docker push us-central1-docker.pkg.dev/shipsafe-ai/routeforge/agent:latest
gcloud run deploy routeforge --image us-central1-docker.pkg.dev/shipsafe-ai/routeforge/agent:latest \
  --region us-central1 --allow-unauthenticated
```

**Dashboard:**
```bash
cd dashboard
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://routeforge-o34wppiwiq-uc.a.run.app \
  -t us-central1-docker.pkg.dev/shipsafe-ai/routeforge/dashboard:latest .
docker push us-central1-docker.pkg.dev/shipsafe-ai/routeforge/dashboard:latest
gcloud run deploy routeforge-dashboard \
  --image us-central1-docker.pkg.dev/shipsafe-ai/routeforge/dashboard:latest \
  --region us-central1 --allow-unauthenticated
```

Both target Google Cloud Run (`us-central1`, project `shipsafe-ai`).

---

## Demo Scenario

1. MR opens on `shipsafe/routing-engine` changing `dynamic_path.py`
2. RouteForge runs it against Hormuz Crisis fixtures
3. Algorithm improves throughput 12% normally but **blocks all Strait routing during crisis**
4. Verdict: **BLOCK** (confidence ~0.92)
5. Dashboard shows animated BLOCK card, live log stream, side-by-side diff, CI status
6. Comment `@routeforge explain` on the MR — Gemini explains exactly which scenario failed and why
7. Human approves in dashboard — verdict comment posted to MR thread

---

## Prompt Injection Defense

User-controlled content (diffs, MR descriptions, notes, file content) is always labeled `[DATA]` in Gemini prompts, never as instructions. Critic runs after RiskGate to challenge verdict and scan for injection patterns. Structured output (constrained generation) on all Gemini calls. Human approval gate mandatory before any external action.
