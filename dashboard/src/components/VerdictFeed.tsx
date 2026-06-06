"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldX, Clock, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";

type VerdictEnum = "PASS" | "BLOCK" | "PENDING";

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

function VerdictBadge({ verdict }: { verdict: VerdictEnum }) {
  if (verdict === "BLOCK")
    return (
      <span className="flex items-center gap-1 text-red-400 font-semibold text-sm">
        <ShieldX size={16} /> BLOCK
      </span>
    );
  if (verdict === "PASS")
    return (
      <span className="flex items-center gap-1 text-green-400 font-semibold text-sm">
        <ShieldCheck size={16} /> PASS
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-yellow-400 font-semibold text-sm">
      <Clock size={16} /> PENDING
    </span>
  );
}

function VerdictCard({ card }: { card: Verdict }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () => approveVerdict(card.mr_iid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdicts"] }),
  });

  return (
    <div
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        "rounded-lg border p-4 cursor-pointer transition-colors",
        card.verdict === "BLOCK"
          ? "border-red-800 bg-red-950/30 hover:bg-red-950/50"
          : "border-green-800 bg-green-950/30 hover:bg-green-950/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-xs font-mono">MR !{card.mr_iid}</span>
          {card.mr_url ? (
            <a
              href={card.mr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block text-gray-100 font-medium mt-0.5 hover:underline"
            >
              {card.mr_title}
            </a>
          ) : (
            <p className="text-gray-100 font-medium mt-0.5">{card.mr_title}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <VerdictBadge verdict={card.verdict} />
          <span className="text-gray-500 text-xs">{Math.round(card.confidence * 100)}% confidence</span>
          {card.posted && <span className="text-blue-400 text-xs">✓ posted</span>}
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-gray-700 pt-4">
          <p className="text-gray-300 text-sm">{card.reasoning}</p>
          {card.affected_scenarios.length > 0 && (
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Affected scenarios</p>
              <ul className="space-y-0.5">
                {card.affected_scenarios.map((s) => (
                  <li key={s} className="font-mono text-xs text-red-300">• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {card.injection_blocked && (
            <p className="text-yellow-400 text-xs">⚠ Prompt injection detected — verdict reviewed</p>
          )}
          <div className="bg-gray-900 rounded p-3">
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Comment draft (pending approval)</p>
            <pre className="text-gray-300 text-xs whitespace-pre-wrap">{card.comment_draft}</pre>
          </div>
          {!card.posted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                approve.mutate();
              }}
              disabled={approve.isPending}
              className="w-full rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2 text-sm transition-colors flex items-center justify-center gap-2"
            >
              {approve.isPending && <Loader2 size={14} className="animate-spin" />}
              Approve &amp; Post to GitLab
            </button>
          )}
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
    return <div className="text-gray-500 text-sm">Loading verdicts...</div>;
  if (error)
    return <div className="text-red-400 text-sm">Error: {(error as Error).message}</div>;
  if (!data?.length)
    return <div className="text-gray-500 text-sm">No verdicts yet — open a GitLab MR to trigger RouteForge.</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-200">Recent verdicts</h2>
      {data.map((card) => (
        <VerdictCard key={card.mr_iid} card={card} />
      ))}
    </div>
  );
}
