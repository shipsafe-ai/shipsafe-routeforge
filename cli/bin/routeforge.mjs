#!/usr/bin/env node
// ShipSafe RouteForge CLI — uniform commands: init | demo | connect | health|status
const BASE = process.env.ROUTEFORGE_API_URL || "https://routeforge-336382452417.us-central1.run.app";
const DASHBOARD = "https://routeforge-dashboard-336382452417.us-central1.run.app";
const NAME = "RouteForge", PKG = "shipsafe-routeforge", PARTNER = "GitLab", SOURCE = "GitLab project", SECRET = "GITLAB_TOKEN";

const [, , cmd, ...args] = process.argv;
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body, timeoutMs = 60000) {
  try {
    return await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { return null; }
}

const health = async () => {
  const r = await req("GET", "/health", null, 20000);
  if (!r) return console.error(`✗ cannot reach ${NAME} at ${BASE}`);
  const d = await r.json().catch(() => ({}));
  console.log(`✓ ${NAME} ${d.status ?? "ok"} — ${BASE}`);
};

const init = async () => {
  console.log(`\nShipSafe ${NAME} — powered by ${PARTNER}\n${"-".repeat(54)}`);
  console.log(`Agent URL : ${BASE}`);
  console.log(`Dashboard : ${DASHBOARD}`);
  console.log(`\nQuick start:`);
  console.log(`  npx ${PKG} demo               # run the demo (zero config, hosted)`);
  console.log(`  npx ${PKG} connect --uri ...  # point at your own ${SOURCE}`);
  console.log(`\nHealth check:`);
  await health();
};

const connect = async () => {
  const uri = flag("--uri");
  console.log(`\nConnect ${NAME} to your own ${SOURCE}:`);
  if (uri) console.log(`  target: ${uri}`);
  console.log(`  1. Store the connection in Secret Manager:`);
  console.log(`       gcloud secrets create ${SECRET} --data-file=-`);
  console.log(`  2. Deploy your own instance pointed at it (see terraform/ in the repo).`);
  console.log(`\n  No setup needed for the demo — it runs on the hosted instance with built-in fixtures:`);
  console.log(`       npx ${PKG} demo`);
};

const demo = async () => {
  console.log(`▶ Seeding demo merge requests on ${NAME} ...`);
  const s = await req("POST", "/demo/seed", null, 60000);
  if (!s) return console.error("✗ demo failed — cannot reach agent");
  process.stdout.write("  RouteForge is reviewing the merge requests");
  let v = [];
  for (let i = 0; i < 7; i++) {
    await sleep(10000); process.stdout.write(".");
    const r = await req("GET", "/verdicts", null, 30000);
    if (r && r.ok) { v = await r.json(); if (v.length) break; }
  }
  console.log("");
  if (!v.length) return console.log("  (still processing — check the dashboard)\n  " + DASHBOARD);
  for (const e of v.slice(0, 3))
    console.log(`  MR !${e.mr_iid}: ${e.verdict} (${Math.round((e.confidence ?? 0) * 100)}% confidence)`);
  console.log(`  Approve before any GitLab post in the dashboard:\n  ${DASHBOARD}`);
};

const status = async () => {
  const r = await req("GET", "/verdicts", null, 30000);
  if (!r || !r.ok) return console.error("✗ cannot fetch verdicts");
  const v = await r.json();
  console.log(`\n${NAME} — ${v.length} verdict(s):`);
  for (const e of v.slice(0, 5))
    console.log(`  MR !${e.mr_iid}: ${e.verdict} (${Math.round((e.confidence ?? 0) * 100)}%) ${e.posted ? "[posted]" : "[awaiting approval]"}`);
};

const cmds = { init, demo, connect, health, status };
const fn = cmds[cmd];
if (!fn) {
  console.log("Usage: npx shipsafe-routeforge <init|demo|connect|health|status>");
  process.exit(1);
}
fn().catch((e) => { console.error(e.message); process.exit(1); });
