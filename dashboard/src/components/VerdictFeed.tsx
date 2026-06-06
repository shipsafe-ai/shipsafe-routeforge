"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldX, Clock, Loader2, ExternalLink,
  GitMerge, AlertCircle, TrendingUp, CheckCircle2, Lightbulb, Plus,
} from "lucide-react";
import { clsx } from "clsx";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PipelineLog } from "./PipelineLog";
import { DiffViewer } from "./DiffViewer";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-o34wppiwiq-uc.a.run.app";

type VerdictEnum = "PASS" | "BLOCK" | "PENDING";

interface PipelineStatus {
  overall: string;
  pipeline_url: string;
  failing_jobs: string[];
  coverage: number | null;
}

interface SuggestedScenario {
  scenario_id: string;
  description: string;
  crisis_mode: boolean;
  strait_id: string;
  expected_blocked: boolean;
  expected_rerouted?: boolean;
  cargo_type?: string;
  rationale: string;
}

interface Verdict {
  mr_iid: number;
  mr_title: string;
  mr_url: string;
  verdict: VerdictEnum;
  confidence: number;
  reasoning: string;
  affected_scenarios: string[];
  comment_draft: string;
  injection_blocked: boolean;
  posted: boolean;
  mr_approved?: boolean;
  timestamp: string;
  pipeline_status?: PipelineStatus;
  issue_url?: string;
  work_item_url?: string;
  changed_functions?: string[];
  throughput_delta_pct?: number;
  scenarios_passed?: number;
  scenarios_total?: number;
  suggested_scenarios?: SuggestedScenario[];
}

async function fetchVerdicts(): Promise<Verdict[]> {
  const r = await fetch(`${API}/verdicts`);
  if (!r.ok) throw new Error("Failed to fetch verdicts");
  return r.json();
}

async function approveVerdict(mr_iid: number): Promise<void> {
  const r = await fetch(`${API}/verdicts/${mr_iid}/approve`, { method: "POST" });
  if (!r.ok) throw new Error("Approval failed");
}

async function createIssue(mr_iid: number): Promise<{ issue_url: string }> {
  const r = await fetch(`${API}/verdicts/${mr_iid}/create-issue`, { method: "POST" });
  if (!r.ok) throw new Error("Issue creation failed");
  return r.json();
}

async function createWorkItem(mr_iid: number): Promise<{ work_item_url: string }> {
  const r = await fetch(`${API}/verdicts/${mr_iid}/create-work-item`, { method: "POST" });
  if (!r.ok) throw new Error("Work item creation failed");
  return r.json();
}

async function acceptSuggestion(mr_iid: number, idx: number): Promise<void> {
  const r = await fetch(`${API}/verdicts/${mr_iid}/suggestions/${idx}/accept`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to add scenario");
}

function VerdictBadge({ verdict }: { verdict: VerdictEnum }) {
  if (verdict === "BLOCK")
    return (
      <span className="flex items-center gap-1 text-red-400 font-bold text-sm animate-pulse">
        <ShieldX size={15} /> BLOCK
      </span>
    );
  if (verdict === "PASS")
    return (
      <span className="flex items-center gap-1 text-green-400 font-bold text-sm">
        <ShieldCheck size={15} /> PASS
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-yellow-400 font-bold text-sm">
      <Clock size={15} /> PENDING
    </span>
  );
}

function CIBadge({ ps }: { ps?: PipelineStatus }) {
  if (!ps || ps.overall === "none") return null;
  const map: Record<string, { color: string; dot: string; label: string }> = {
    passing: { color: "text-green-400", dot: "bg-green-400", label: "CI passing" },
    failing: { color: "text-red-400", dot: "bg-red-400", label: "CI failing" },
    running: { color: "text-yellow-400", dot: "bg-yellow-400 animate-pulse", label: "CI running" },
    pending: { color: "text-gray-400", dot: "bg-gray-500", label: "CI pending" },
  };
  const style = map[ps.overall] ?? { color: "text-gray-500", dot: "bg-gray-600", label: `CI ${ps.overall}` };
  return (
    <a
      href={ps.pipeline_url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center gap-1 text-xs font-mono ${style.color} hover:underline`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </a>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${color} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="text-xs text-gray-400 tabular-nums w-8">{pct}%</span>
    </div>
  );
}

function PassStats({ card }: { card: Verdict }) {
  const delta = card.throughput_delta_pct ?? 0;
  const passed = card.scenarios_passed ?? 0;
  const total = card.scenarios_total ?? 0;
  return (
    <div className="flex items-center gap-3 mt-1.5">
      {delta > 0 && (
        <span className="flex items-center gap-1 text-xs text-green-400 font-mono">
          <TrendingUp size={11} />
          +{delta.toFixed(1)}% throughput
        </span>
      )}
      {total > 0 && (
        <span className="flex items-center gap-1 text-xs text-green-500 font-mono">
          <CheckCircle2 size={11} />
          {passed}/{total} scenarios
        </span>
      )}
    </div>
  );
}

function VerdictCard({ card, isNew }: { card: Verdict; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"verdict" | "diff">("verdict");
  const qc = useQueryClient();
  const isBlock = card.verdict === "BLOCK";

  const approve = useMutation({
    mutationFn: () => approveVerdict(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  const makeIssue = useMutation({
    mutationFn: () => createIssue(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  const makeWorkItem = useMutation({
    mutationFn: () => createWorkItem(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  const addSuggestion = useMutation({
    mutationFn: (idx: number) => acceptSuggestion(card.mr_iid, idx),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenarios"] }),
  });

  const ts = new Date(card.timestamp).toLocaleString();

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, y: -16, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        "rounded-xl border cursor-pointer transition-colors duration-150",
        isBlock
          ? "border-red-900/70 bg-red-950/20 hover:bg-red-950/35 shadow-sm shadow-red-950/30"
          : "border-green-900/50 bg-green-950/10 hover:bg-green-950/20 shadow-sm shadow-green-950/20"
      )}
    >
      {/* Card header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-gray-500 text-xs font-mono">MR !{card.mr_iid}</span>
            <CIBadge ps={card.pipeline_status} />
          </div>
          {card.mr_url ? (
            <a
              href={card.mr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-gray-100 font-medium text-sm hover:text-brand transition-colors truncate"
            >
              {card.mr_title}
              <ExternalLink size={11} className="flex-shrink-0 text-gray-600" />
            </a>
          ) : (
            <p className="text-gray-100 font-medium text-sm truncate">{card.mr_title}</p>
          )}
          {!isBlock && <PassStats card={card} />}
          <p className="text-gray-600 text-xs mt-0.5">{ts}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <VerdictBadge verdict={card.verdict} />
          <div className="w-24">
            <ConfidenceMeter value={card.confidence} />
          </div>
          {card.posted && (
            <span className="text-blue-400 text-xs flex items-center gap-0.5">
              <GitMerge size={10} /> {card.mr_approved ? "approved" : "posted"}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            onClick={(e) => e.stopPropagation()}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-800">
              {/* Tab bar */}
              <div className="flex border-b border-gray-800">
                {(["verdict", "diff"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-xs font-medium transition-colors ${
                      tab === t
                        ? "text-gray-100 border-b-2 border-brand -mb-px"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t === "verdict" ? "Verdict" : "Diff"}
                  </button>
                ))}
              </div>

              {tab === "diff" ? (
                <div className="px-4 py-4">
                  <DiffViewer mrIid={card.mr_iid} failingFunctions={card.changed_functions ?? []} />
                </div>
              ) : (
              <div className="px-4 py-4 space-y-4">
              {/* Reasoning */}
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Reasoning</p>
                <p className="text-gray-300 text-sm leading-relaxed">{card.reasoning}</p>
              </div>

              {/* Affected scenarios (BLOCK) */}
              {isBlock && card.affected_scenarios.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1.5">Affected scenarios</p>
                  <div className="flex flex-wrap gap-1.5">
                    {card.affected_scenarios.map((s) => (
                      <span key={s} className="font-mono text-xs bg-red-950/40 border border-red-900/50 text-red-300 px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* PASS: scenarios passed list */}
              {!isBlock && (card.scenarios_total ?? 0) > 0 && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1.5">Scenarios</p>
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 text-xs font-mono">
                      ✓ {card.scenarios_passed}/{card.scenarios_total} passed
                    </span>
                    {(card.throughput_delta_pct ?? 0) > 0 && (
                      <span className="text-green-400 text-xs font-mono">
                        · +{card.throughput_delta_pct?.toFixed(1)}% throughput improvement
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Changed functions */}
              {card.changed_functions && card.changed_functions.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1.5">Changed functions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {card.changed_functions.map((fn) => (
                      <span key={fn} className="font-mono text-xs bg-gray-800 border border-gray-700 text-gray-300 px-2 py-0.5 rounded">
                        {fn}()
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CI failing jobs */}
              {(card.pipeline_status?.failing_jobs?.length ?? 0) > 0 && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <AlertCircle size={11} className="text-red-400" /> Failing CI jobs
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {card.pipeline_status?.failing_jobs?.map((j) => (
                      <span key={j} className="font-mono text-xs bg-red-950/30 border border-red-900/40 text-red-300 px-2 py-0.5 rounded">
                        {j}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Injection warning */}
              {card.injection_blocked && (
                <p className="text-yellow-400 text-xs flex items-center gap-1">
                  ⚠ Prompt injection detected in diff — verdict independently reviewed
                </p>
              )}

              {/* Live pipeline log */}
              <PipelineLog mrIid={card.mr_iid} />

              {/* Comment draft */}
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Comment draft</p>
                <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                  <pre className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed">{card.comment_draft}</pre>
                </div>
              </div>

              {/* AI-suggested scenarios */}
              {(card.suggested_scenarios?.length ?? 0) > 0 && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Lightbulb size={11} className="text-yellow-400" /> Suggested scenarios
                  </p>
                  <div className="space-y-2">
                    {card.suggested_scenarios!.map((s, idx) => (
                      <div key={s.scenario_id} className="flex items-start gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs text-gray-300">{s.scenario_id}</span>
                          {s.crisis_mode && (
                            <span className="ml-1.5 text-xs bg-red-950/50 border border-red-900/50 text-red-400 px-1 rounded">crisis</span>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{s.description}</p>
                          <p className="text-xs text-yellow-600 mt-0.5 italic">{s.rationale}</p>
                        </div>
                        <button
                          onClick={() => addSuggestion.mutate(idx)}
                          disabled={addSuggestion.isPending}
                          className="flex-shrink-0 flex items-center gap-1 text-xs text-brand hover:text-orange-400 border border-brand/40 hover:border-orange-400 rounded px-2 py-1 transition-colors disabled:opacity-40"
                        >
                          <Plus size={10} /> Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Issue / Work Item links */}
              {card.issue_url && (
                <a
                  href={card.issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-400 hover:underline"
                >
                  <ExternalLink size={11} /> View tracking issue
                </a>
              )}
              {card.work_item_url && (
                <a
                  href={card.work_item_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-purple-400 hover:underline"
                >
                  <ExternalLink size={11} /> View work item (GitLab Ultimate)
                </a>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {!card.posted && (
                  <button
                    onClick={() => approve.mutate()}
                    disabled={approve.isPending}
                    className="flex-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2 text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {approve.isPending && <Loader2 size={13} className="animate-spin" />}
                    Approve &amp; Post to GitLab
                  </button>
                )}
                {isBlock && !card.issue_url && (
                  <button
                    onClick={() => makeIssue.mutate()}
                    disabled={makeIssue.isPending}
                    className="flex-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 font-semibold py-2 text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {makeIssue.isPending && <Loader2 size={13} className="animate-spin" />}
                    Create GitLab Issue
                  </button>
                )}
                {isBlock && !card.work_item_url && (
                  <button
                    onClick={() => makeWorkItem.mutate()}
                    disabled={makeWorkItem.isPending}
                    className="flex-1 rounded-lg bg-purple-900/50 hover:bg-purple-900/70 border border-purple-800/50 disabled:opacity-50 text-purple-300 font-semibold py-2 text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {makeWorkItem.isPending && <Loader2 size={13} className="animate-spin" />}
                    Create Work Item
                  </button>
                )}
              </div>
              </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function VerdictFeed() {
  const prevIidsRef = useRef<Set<number>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    refetchInterval: 10_000,
  });

  // Track which MR IIDs are new since last render
  const newIids = new Set<number>();
  if (data) {
    data.forEach((v) => {
      if (!prevIidsRef.current.has(v.mr_iid)) newIids.add(v.mr_iid);
    });
    prevIidsRef.current = new Set(data.map((v) => v.mr_iid));
  }

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading verdicts...
      </div>
    );
  if (error)
    return <div className="text-red-400 text-sm">Error: {(error as Error).message}</div>;
  if (!data?.length)
    return (
      <div className="text-center py-16">
        <ShieldCheck size={32} className="text-gray-700 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No verdicts yet</p>
        <p className="text-gray-600 text-xs mt-1">Open a GitLab MR to trigger RouteForge</p>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
          Recent verdicts
        </h2>
        <span className="text-xs text-gray-600">auto-refresh 10s</span>
      </div>
      <AnimatePresence mode="popLayout">
        {data.map((card) => (
          <VerdictCard key={card.mr_iid} card={card} isNew={newIids.has(card.mr_iid)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
