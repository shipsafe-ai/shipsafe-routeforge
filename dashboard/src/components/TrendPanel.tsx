"use client";

import { useQuery } from "@tanstack/react-query";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-o34wppiwiq-uc.a.run.app";

interface Verdict {
  verdict: "PASS" | "BLOCK";
  confidence: number;
  affected_scenarios: string[];
}

async function fetchVerdicts(): Promise<Verdict[]> {
  const r = await fetch(`${API}/verdicts`);
  if (!r.ok) throw new Error("failed");
  return r.json();
}

export function TrendPanel() {
  const { data } = useQuery<Verdict[]>({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    refetchInterval: 10_000,
  });

  if (!data || data.length === 0) return null;

  const last10 = [...data].slice(0, 10).reverse();
  const total = data.length;
  const passes = data.filter((v) => v.verdict === "PASS").length;
  const safetyScore = Math.round((passes / total) * 100);

  // Top failing scenario
  const counts: Record<string, number> = {};
  data.forEach((v) => v.affected_scenarios?.forEach((s) => { counts[s] = (counts[s] ?? 0) + 1; }));
  const topScenario = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  // Streak
  let streak = 0;
  let streakType: "PASS" | "BLOCK" | null = null;
  for (const v of data) {
    if (!streakType) { streakType = v.verdict; streak = 1; }
    else if (v.verdict === streakType) streak++;
    else break;
  }

  return (
    <div className="flex items-center gap-6 bg-[#111215] border border-[#1e1e26] rounded-lg px-5 py-3 mb-5">
      {/* Sparkline */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-gray-600 uppercase tracking-wide font-mono">trend</span>
        <div className="flex items-end gap-0.5 h-6">
          {last10.map((v, i) => (
            <div
              key={i}
              title={`${v.verdict} ${Math.round(v.confidence * 100)}%`}
              className={`w-2 rounded-[1px] transition-all ${v.verdict === "PASS" ? "bg-green-500/70" : "bg-red-500/60"}`}
              style={{ height: `${Math.max(20, Math.round(v.confidence * 100))}%` }}
            />
          ))}
          {Array.from({ length: Math.max(0, 10 - last10.length) }).map((_, i) => (
            <div key={`e-${i}`} className="w-2 h-1 rounded-[1px] bg-gray-800" />
          ))}
        </div>
      </div>

      <div className="w-px h-6 bg-[#1e1e26]" />

      {/* Safety score */}
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg font-semibold tabular leading-none ${
          safetyScore >= 70 ? "text-green-400" : safetyScore >= 40 ? "text-yellow-400" : "text-red-400"
        }`}>{safetyScore}%</span>
        <span className="text-[11px] text-gray-600">safety score</span>
      </div>

      <div className="w-px h-6 bg-[#1e1e26]" />

      {/* Streak */}
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg font-semibold tabular leading-none ${streakType === "PASS" ? "text-green-400" : "text-red-400"}`}>
          {streak}×
        </span>
        <span className={`text-[11px] ${streakType === "PASS" ? "text-green-600" : "text-red-600"}`}>
          {streakType?.toLowerCase()} streak
        </span>
      </div>

      {topScenario && (
        <>
          <div className="w-px h-6 bg-[#1e1e26]" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] text-gray-600 uppercase tracking-wide font-mono flex-shrink-0">top fail</span>
            <span className="font-mono text-[11px] text-orange-400 truncate">{topScenario[0]}</span>
            <span className="text-[10px] text-gray-600 flex-shrink-0">{topScenario[1]}×</span>
          </div>
        </>
      )}

      <div className="ml-auto text-[10px] text-gray-700 font-mono flex-shrink-0">{total} scanned</div>
    </div>
  );
}
