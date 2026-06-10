"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";

interface LogEntry {
  step: number;
  total: number;
  label: string;
  done: boolean;
}

export function PipelineLog({ mrIid }: { mrIid: number }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/verdicts/${mrIid}/log`);

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data);
        setEntries((prev) => {
          // dedupe by step+label
          const exists = prev.some((p) => p.step === entry.step && p.label === entry.label);
          return exists ? prev : [...prev, entry];
        });
        if (entry.done) {
          setFinished(true);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => es.close();
  }, [mrIid]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const latest = entries[entries.length - 1];
  const progress = latest ? (latest.step / latest.total) * 100 : 0;

  return (
    <div className="mt-3 rounded-lg border border-[#1e1e26] bg-[#0d0d10] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e26] bg-[#111215]">
        <Terminal size={12} className="text-gray-500" />
        <span className="text-xs text-gray-500 font-mono">pipeline log</span>
        <div className="ml-auto flex items-center gap-1.5">
          {!finished && connected && (
            <Loader2 size={11} className="text-brand animate-spin" />
          )}
          {finished && (
            <CheckCircle2 size={11} className="text-green-400" />
          )}
          <span className="text-xs text-gray-600 font-mono">
            {latest ? `${latest.step}/${latest.total}` : "—"}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {!finished && (
        <div className="h-0.5 bg-[#1e1e26]">
          <motion.div
            className="h-full bg-brand"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      )}
      {finished && <div className="h-0.5 bg-green-600" />}

      {/* Log lines */}
      <div className="px-3 py-2 space-y-1 max-h-44 overflow-y-auto font-mono text-xs">
        {entries.length === 0 && (
          <p className="text-gray-600 italic">Waiting for pipeline events…</p>
        )}
        <AnimatePresence initial={false}>
          {entries.map((e, i) => (
            <motion.div
              key={`${e.step}-${e.label}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex items-start gap-2 ${
                e.done ? "text-green-400" : i === entries.length - 1 ? "text-gray-200" : "text-gray-500"
              }`}
            >
              <span className="text-gray-700 flex-shrink-0 tabular-nums w-5 text-right">
                {e.step}.
              </span>
              <span className="leading-relaxed">{e.label}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
