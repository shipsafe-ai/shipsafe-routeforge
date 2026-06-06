"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldX, Clock, Loader2, ExternalLink,
  GitMerge, AlertCircle, TrendingUp, CheckCircle2, Lightbulb, Plus, GitBranch,
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

// CI status pill
function CIBadge({ ps }: { ps?: PipelineStatus }) {
  if (!ps || ps.overall === "none") return null;
  const cfg: Record<string, { dot: string; text: string; label: string }> = {
    passing: { dot: "bg-green-500",                     text: "text-green-500",  label: "passing" },
    failing: { dot: "bg-red-500",                       text: "text-red-400",    label: "failing" },
    running: { dot: "bg-yellow-400 animate-pulse",      text: "text-yellow-400", label: "running" },
    pending: { dot: "bg-gray-500",                      text: "text-gray-500",   label: "pending" },
  };
  const s = cfg[ps.overall] ?? { dot: "bg-gray-600", text: "text-gray-500", label: ps.overall };
  return (
    <a
      href={ps.pipeline_url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-[11px] font-mono ${s.text} hover:underline cursor-pointer`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      CI {s.label}
    </a>
  );
}

// Thin confidence bar
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const fill = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-[3px] bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${fill} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
      <span className="text-[11px] text-gray-500 tabular font-mono w-7">{pct}%</span>
    </div>
  );
}

function VerdictCard({ card, isNew }: { card: Verdict; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"verdict" | "diff">("verdict");
  const qc = useQueryClient();
  const isBlock = card.verdict === "BLOCK";

  const approve    = useMutation({ mutationFn: () => approveVerdict(card.mr_iid),              onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }) });
  const makeIssue  = useMutation({ mutationFn: () => createIssue(card.mr_iid),                 onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }) });
  const makeWork   = useMutation({ mutationFn: () => createWorkItem(card.mr_iid),              onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }) });
  const addSuggest = useMutation({ mutationFn: (idx: number) => acceptSuggestion(card.mr_iid, idx), onSuccess: () => qc.invalidateQueries({ queryKey: ["scenarios"] }) });

  const ts = new Date(card.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  // Left border: the ONLY color signal — no background tints
  const leftBorder = isBlock ? "border-l-[3px] border-l-red-500/70" : card.verdict === "PASS" ? "border-l-[3px] border-l-green-500/60" : "border-l-[3px] border-l-gray-700";

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, y: -12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        "rounded-lg border border-[#1e1e26] bg-[#111215] cursor-pointer transition-colors duration-150 hover:bg-[#14141a]",
        leftBorder
      )}
    >
      {/* Header row */}
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Verdict icon */}
        <div className="flex-shrink-0 mt-0.5">
          {card.verdict === "BLOCK"
            ? <ShieldX size={14} className="text-red-400" />
            : card.verdict === "PASS"
            ? <ShieldCheck size={14} className="text-green-400" />
            : <Clock size={14} className="text-yellow-400" />}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Top line: MR# + title */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[11px] text-gray-600">!{card.mr_iid}</span>
            {card.mr_url ? (
              <a
                href={card.mr_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-gray-200 text-sm font-medium hover:text-white transition-colors truncate"
              >
                {card.mr_title}
              </a>
            ) : (
              <span className="text-gray-200 text-sm font-medium truncate">{card.mr_title}</span>
            )}
          </div>

          {/* Second line: metadata */}
          <div className="flex items-center gap-3">
            <CIBadge ps={card.pipeline_status} />
            {card.verdict === "PASS" && (card.throughput_delta_pct ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-green-500 font-mono">
                <TrendingUp size={10} /> +{card.throughput_delta_pct!.toFixed(1)}%
              </span>
            )}
            {card.verdict === "PASS" && (card.scenarios_total ?? 0) > 0 && (
              <span className="text-[11px] text-green-600 font-mono">
                {card.scenarios_passed}/{card.scenarios_total} scenarios
              </span>
            )}
            <span className="text-[11px] text-gray-600">{ts}</span>
          </div>
        </div>

        {/* Right: verdict + confidence */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <span className={clsx(
            "text-xs font-semibold font-mono tracking-wide",
            isBlock ? "text-red-400" : card.verdict === "PASS" ? "text-green-400" : "text-yellow-400"
          )}>
            {card.verdict}
          </span>
          <ConfidenceBar value={card.confidence} />
          {card.posted && (
            <span className="text-[10px] text-gray-600 font-mono flex items-center gap-1">
              <GitMerge size={9} />
              {card.mr_approved ? "approved" : "posted"}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            onClick={(e) => e.stopPropagation()}
            className="overflow-hidden"
          >
            <div className="border-t border-[#1e1e26]">
              {/* Tabs */}
              <div className="flex border-b border-[#1e1e26]">
                {(["verdict", "diff"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={clsx(
                      "px-4 py-2 text-[11px] font-medium transition-colors",
                      tab === t
                        ? "text-gray-100 border-b border-brand -mb-px"
                        : "text-gray-600 hover:text-gray-400"
                    )}
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
                    <SectionLabel>Reasoning</SectionLabel>
                    <p className="text-gray-300 text-sm leading-relaxed">{card.reasoning}</p>
                  </div>

                  {/* Affected scenarios */}
                  {isBlock && card.affected_scenarios.length > 0 && (
                    <div>
                      <SectionLabel>Failing scenarios</SectionLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {card.affected_scenarios.map((s) => (
                          <span key={s} className="font-mono text-[11px] bg-red-950/30 border border-red-900/40 text-red-300 px-2 py-px rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PASS: scenarios */}
                  {!isBlock && (card.scenarios_total ?? 0) > 0 && (
                    <div>
                      <SectionLabel>Scenarios</SectionLabel>
                      <div className="flex items-center gap-3">
                        <span className="text-green-400 text-[11px] font-mono">
                          {card.scenarios_passed}/{card.scenarios_total} passed
                        </span>
                        {(card.throughput_delta_pct ?? 0) > 0 && (
                          <span className="text-green-400 text-[11px] font-mono">
                            +{card.throughput_delta_pct?.toFixed(1)}% throughput
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Changed functions */}
                  {(card.changed_functions?.length ?? 0) > 0 && (
                    <div>
                      <SectionLabel>Changed functions</SectionLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {card.changed_functions!.map((fn) => (
                          <span key={fn} className="font-mono text-[11px] bg-gray-800/60 border border-[#1e1e26] text-gray-400 px-2 py-px rounded">
                            {fn}()
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CI failing jobs */}
                  {(card.pipeline_status?.failing_jobs?.length ?? 0) > 0 && (
                    <div>
                      <SectionLabel icon={<AlertCircle size={10} className="text-red-400" />}>Failing CI jobs</SectionLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {card.pipeline_status?.failing_jobs?.map((j) => (
                          <span key={j} className="font-mono text-[11px] bg-red-950/20 border border-red-900/30 text-red-400 px-2 py-px rounded">
                            {j}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Injection warning */}
                  {card.injection_blocked && (
                    <p className="text-yellow-500 text-[11px] flex items-center gap-1.5">
                      <AlertCircle size={11} /> Prompt injection detected in diff — verdict independently verified
                    </p>
                  )}

                  {/* Pipeline log */}
                  <PipelineLog mrIid={card.mr_iid} />

                  {/* AI-suggested scenarios */}
                  {(card.suggested_scenarios?.length ?? 0) > 0 && (
                    <div>
                      <SectionLabel icon={<Lightbulb size={10} className="text-yellow-400" />}>Suggested scenarios</SectionLabel>
                      <div className="space-y-2">
                        {card.suggested_scenarios!.map((s, idx) => (
                          <div key={s.scenario_id} className="flex items-start gap-2 bg-[#17171c] border border-[#1e1e26] rounded px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[11px] text-gray-300">{s.scenario_id}</span>
                                {s.crisis_mode && (
                                  <span className="text-[10px] bg-red-950/40 border border-red-900/40 text-red-400 px-1 rounded">crisis</span>
                                )}
                                <span className="text-[10px] text-gray-600 font-mono">{s.strait_id}</span>
                              </div>
                              <p className="text-[11px] text-gray-500 mt-px">{s.description}</p>
                              <p className="text-[10px] text-yellow-700 mt-px italic">{s.rationale}</p>
                            </div>
                            <button
                              onClick={() => addSuggest.mutate(idx)}
                              disabled={addSuggest.isPending}
                              className="flex-shrink-0 flex items-center gap-1 text-[11px] text-brand hover:text-orange-400 border border-brand/30 hover:border-orange-400/60 rounded px-2 py-1 transition-colors disabled:opacity-40"
                            >
                              <Plus size={10} /> Add
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Comment draft */}
                  <div>
                    <SectionLabel>Comment draft</SectionLabel>
                    <div className="bg-gray-950 rounded border border-[#1e1e26] p-3">
                      <pre className="text-gray-400 text-[11px] font-mono whitespace-pre-wrap leading-relaxed">{card.comment_draft}</pre>
                    </div>
                  </div>

                  {/* External links */}
                  <div className="flex flex-wrap gap-3">
                    {card.issue_url && (
                      <a href={card.issue_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline">
                        <ExternalLink size={10} /> Tracking issue
                      </a>
                    )}
                    {card.work_item_url && (
                      <a href={card.work_item_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-purple-400 hover:underline">
                        <ExternalLink size={10} /> Work item (Ultimate)
                      </a>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!card.posted && (
                      <button
                        onClick={() => approve.mutate()}
                        disabled={approve.isPending}
                        className="flex-1 rounded bg-brand hover:bg-orange-500 disabled:opacity-40 text-white font-medium py-2 text-xs transition-colors flex items-center justify-center gap-2"
                      >
                        {approve.isPending && <Loader2 size={11} className="animate-spin" />}
                        Approve &amp; Post to GitLab
                      </button>
                    )}
                    {isBlock && !card.issue_url && (
                      <button
                        onClick={() => makeIssue.mutate()}
                        disabled={makeIssue.isPending}
                        className="flex-1 rounded bg-[#17171c] hover:bg-[#1b1b23] border border-[#1e1e26] disabled:opacity-40 text-gray-300 font-medium py-2 text-xs transition-colors flex items-center justify-center gap-2"
                      >
                        {makeIssue.isPending && <Loader2 size={11} className="animate-spin" />}
                        Create Issue
                      </button>
                    )}
                    {isBlock && !card.work_item_url && (
                      <button
                        onClick={() => makeWork.mutate()}
                        disabled={makeWork.isPending}
                        className="flex-1 rounded bg-[#17171c] hover:bg-[#1b1b23] border border-purple-900/40 disabled:opacity-40 text-purple-400 font-medium py-2 text-xs transition-colors flex items-center justify-center gap-2"
                      >
                        {makeWork.isPending && <Loader2 size={11} className="animate-spin" />}
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

function SectionLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <p className="text-[10px] text-gray-600 uppercase tracking-widest font-medium mb-1.5 flex items-center gap-1">
      {icon}{children}
    </p>
  );
}

export function VerdictFeed() {
  const prevIidsRef = useRef<Set<number>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    refetchInterval: 10_000,
  });

  const newIids = new Set<number>();
  if (data) {
    data.forEach((v) => { if (!prevIidsRef.current.has(v.mr_iid)) newIids.add(v.mr_iid); });
    prevIidsRef.current = new Set(data.map((v) => v.mr_iid));
  }

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-gray-600 text-sm py-8">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  if (error)
    return <div className="text-red-400 text-xs py-4">Error: {(error as Error).message}</div>;
  if (!data?.length)
    return (
      <div className="text-center py-16 border border-dashed border-[#1e1e26] rounded-lg">
        <GitBranch size={28} className="text-gray-700 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No verdicts yet</p>
        <p className="text-gray-700 text-xs mt-1">Open a GitLab MR on the connected project to trigger RouteForge</p>
      </div>
    );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-medium text-gray-500 uppercase tracking-widest">
          Verdicts
        </h2>
        <span className="text-[10px] text-gray-700 font-mono">↻ 10s</span>
      </div>
      <AnimatePresence mode="popLayout">
        {data.map((card) => (
          <VerdictCard key={card.mr_iid} card={card} isNew={newIids.has(card.mr_iid)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
