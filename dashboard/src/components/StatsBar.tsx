"use client";

import { useQuery } from "@tanstack/react-query";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-o34wppiwiq-uc.a.run.app";

interface Verdict {
  verdict: string;
  confidence: number;
  timestamp: string;
}

export function StatsBar() {
  const { data: verdicts = [] } = useQuery<Verdict[]>({
    queryKey: ["verdicts"],
    queryFn: async () => {
      const r = await fetch(`${API}/verdicts`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const total = verdicts.length;
  const blocks = verdicts.filter((v) => v.verdict === "BLOCK").length;
  const passes = total - blocks;
  const blockRate = total ? Math.round((blocks / total) * 100) : 0;
  const avgConf = total
    ? Math.round((verdicts.reduce((s, v) => s + v.confidence, 0) / total) * 100)
    : 0;

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      <StatCard
        label="MRs Scanned"
        value={total}
        sub="total"
        accent="neutral"
      />
      <StatCard
        label="Blocked"
        value={blocks}
        sub={total ? `${blockRate}% of scanned` : "—"}
        accent="block"
      />
      <StatCard
        label="Passed"
        value={passes}
        sub={total ? `${100 - blockRate}% pass rate` : "—"}
        accent="pass"
      />
      <StatCard
        label="Avg Confidence"
        value={total ? `${avgConf}%` : "—"}
        sub={avgConf >= 70 ? "high signal" : avgConf >= 40 ? "moderate signal" : total ? "low signal" : "no data"}
        accent={avgConf >= 70 ? "pass" : avgConf >= 40 ? "warn" : "neutral"}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent: "block" | "pass" | "warn" | "neutral";
}) {
  const borderColor =
    accent === "block" ? "border-l-red-500/60" :
    accent === "pass"  ? "border-l-green-500/60" :
    accent === "warn"  ? "border-l-yellow-500/60" :
    "border-l-gray-700";

  const valueColor =
    accent === "block" ? "text-red-400" :
    accent === "pass"  ? "text-green-400" :
    accent === "warn"  ? "text-yellow-400" :
    "text-gray-100";

  return (
    <div className={`bg-[#111215] border border-[#1e1e26] border-l-2 ${borderColor} rounded-lg px-4 py-3`}>
      <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className={`text-2xl font-semibold tabular leading-none ${valueColor}`}>{value}</p>
      <p className="text-[11px] text-gray-600 mt-1">{sub}</p>
    </div>
  );
}
