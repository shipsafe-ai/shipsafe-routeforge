"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldX, Clock, Loader2, ExternalLink, GitMerge, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";

type VerdictEnum = "PASS" | "BLOCK" | "PENDING";

interface PipelineStatus {
  overall: string;
  pipeline_url: string;
  failing_jobs: string[];
  coverage: number | null;
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
  timestamp: string;
  pipeline_status?: PipelineStatus;
  issue_url?: string;
  changed_functions?: string[];
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

function VerdictBadge({ verdict }: { verdict: VerdictEnum }) {
  if (verdict === "BLOCK")
    return (
      <span className="flex items-center gap-1 text-red-400 font-bold text-sm">
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
    running: { color: "text-yellow-400", dot: "bg-yellow-400", label: "CI running" },
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
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 tabular-nums w-8">{pct}%</span>
    </div>
  );
}

function VerdictCard({ card }: { card: Verdict }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const approve = useMutation({
    mutationFn: () => approveVerdict(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  const makeIssue = useMutation({
    mutationFn: () => createIssue(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  const isBlock = card.verdict === "BLOCK";
  const ts = new Date(card.timestamp).toLocaleString();

  return (
    <div
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        "rounded-xl border cursor-pointer transition-all",
        isBlock
          ? "border-red-900 bg-red-950/20 hover:bg-red-950/35"
          : "border-green-900 bg-green-950/15 hover:bg-green-950/25"
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
          <p className="text-gray-600 text-xs mt-0.5">{ts}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <VerdictBadge verdict={card.verdict} />
          <div className="w-24">
            <ConfidenceMeter value={card.confidence} />
          </div>
          {card.posted && (
            <span className="text-blue-400 text-xs flex items-center gap-0.5">
              <GitMerge size={10} /> posted
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="border-t border-gray-800 px-4 py-4 space-y-4"
        >
          {/* Reasoning */}
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Reasoning</p>
            <p className="text-gray-300 text-sm leading-relaxed">{card.reasoning}</p>
          </div>

          {/* Affected scenarios */}
          {card.affected_scenarios.length > 0 && (
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

          {/* Comment draft */}
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Comment draft</p>
            <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
              <pre className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed">{card.comment_draft}</pre>
            </div>
          </div>

          {/* Issue link */}
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

          {/* Actions */}
          <div className="flex gap-2 pt-1">
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
          </div>
        </div>
      )}
    </div>
  );
}

export function VerdictFeed() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    refetchInterval: 10_000,
  });

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
      {data.map((card) => (
        <VerdictCard key={card.mr_iid} card={card} />
      ))}
    </div>
  );
}
