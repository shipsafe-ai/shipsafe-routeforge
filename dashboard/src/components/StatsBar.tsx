"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ShieldX, TrendingUp } from "lucide-react";

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
  const blockRate = total ? Math.round((blocks / total) * 100) : 0;
  const avgConf = total
    ? Math.round((verdicts.reduce((s, v) => s + v.confidence, 0) / total) * 100)
    : 0;

  const stats = [
    {
      label: "MRs Scanned",
      value: total,
      sub: "total",
      icon: <Activity size={15} className="text-brand" />,
      valueClass: "text-gray-100",
    },
    {
      label: "Blocked",
      value: blocks,
      sub: `${blockRate}% block rate`,
      icon: <ShieldX size={15} className="text-red-400" />,
      valueClass: "text-red-400",
    },
    {
      label: "Avg Confidence",
      value: `${avgConf}%`,
      sub: "across verdicts",
      icon: <TrendingUp size={15} className="text-green-400" />,
      valueClass: "text-green-400",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {stats.map(({ label, value, sub, icon, valueClass }) => (
        <div
          key={label}
          className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center gap-3"
        >
          <div className="p-2 bg-gray-800 rounded-md">{icon}</div>
          <div>
            <p className="text-gray-500 text-xs">{label}</p>
            <p className={`text-xl font-bold leading-tight ${valueClass}`}>{value}</p>
            <p className="text-gray-600 text-xs">{sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
