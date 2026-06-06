"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, ShieldX, ShieldCheck, Flame, Zap } from "lucide-react";

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

  // Sparkline: last 7 verdicts (oldest → newest)
  const last7 = [...data].slice(0, 7).reverse();

  // Top failing scenario
  const scenarioCounts: Record<string, number> = {};
  data.forEach((v) => {
    v.affected_scenarios?.forEach((s) => {
      scenarioCounts[s] = (scenarioCounts[s] ?? 0) + 1;
    });
  });
  const topScenario = Object.entries(scenarioCounts).sort((a, b) => b[1] - a[1])[0];

  // Safety score
  const total = data.length;
  const passes = data.filter((v) => v.verdict === "PASS").length;
  const safetyScore = Math.round((passes / total) * 100);

  // Streak
  let streak = 0;
  let streakType: "PASS" | "BLOCK" | null = null;
  for (const v of data) {
    if (streakType === null) {
      streakType = v.verdict;
      streak = 1;
    } else if (v.verdict === streakType) {
      streak++;
    } else {
      break;
    }
  }

  // Avg confidence
  const avgConf = Math.round(
    (data.reduce((sum, v) => sum + v.confidence, 0) / total) * 100
  );

  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      {/* Sparkline */}
      <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Last {last7.length} verdicts</p>
        <div className="flex items-end gap-1 h-8">
          {last7.map((v, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-all ${
                v.verdict === "PASS" ? "bg-green-500/70" : "bg-red-500/70"
              }`}
              style={{ height: `${Math.round(v.confidence * 100)}%`, minHeight: 4 }}
              title={`${v.verdict} — ${Math.round(v.confidence * 100)}%`}
            />
          ))}
          {/* Pad to 7 if fewer */}
          {Array.from({ length: Math.max(0, 7 - last7.length) }).map((_, i) => (
            <div key={`pad-${i}`} className="flex-1 rounded-sm bg-gray-800" style={{ height: 4 }} />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-600">older</span>
          <span className="text-xs text-gray-600">latest</span>
        </div>
      </div>

      {/* Safety score */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Safety score</p>
        <div className="flex items-end gap-1.5">
          <span className={`text-2xl font-bold tabular-nums ${
            safetyScore >= 70 ? "text-green-400" : safetyScore >= 40 ? "text-yellow-400" : "text-red-400"
          }`}>
            {safetyScore}%
          </span>
          {safetyScore >= 70 ? (
            <TrendingUp size={14} className="text-green-400 mb-1" />
          ) : safetyScore >= 40 ? (
            <Minus size={14} className="text-yellow-400 mb-1" />
          ) : (
            <TrendingDown size={14} className="text-red-400 mb-1" />
          )}
        </div>
        <p className="text-xs text-gray-600">{passes}/{total} PASS</p>
      </div>

      {/* Streak + top scenario */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Streak</p>
        <div className="flex items-center gap-1.5">
          {streakType === "PASS" ? (
            <ShieldCheck size={14} className="text-green-400" />
          ) : (
            <ShieldX size={14} className="text-red-400" />
          )}
          <span className={`text-lg font-bold ${streakType === "PASS" ? "text-green-400" : "text-red-400"}`}>
            {streak}×
          </span>
          <span className="text-xs text-gray-500">{streakType}</span>
        </div>
        {topScenario && (
          <p className="text-xs text-gray-600 mt-1 truncate" title={topScenario[0]}>
            <Flame size={9} className="inline text-orange-500 mr-0.5" />
            {topScenario[0]} ({topScenario[1]}×)
          </p>
        )}
      </div>
    </div>
  );
}
