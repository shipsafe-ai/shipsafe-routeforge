"use client";

import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";

const MODEL_LABELS: Record<string, { label: string; hint: string }> = {
  "gemini-2.5-flash": { label: "Flash", hint: "Fast · Default · thinking up to 24k tokens" },
  "gemini-2.5-pro": { label: "Pro", hint: "Deep Reasoning · Slower · higher quality" },
};

export function ModelSelector() {
  const [current, setCurrent] = useState<string>("gemini-2.5-flash");
  const [available, setAvailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${API}/config`)
      .then((r) => r.json())
      .then((d) => {
        setCurrent(d.model);
        setAvailable(d.available_models ?? []);
      })
      .catch(() => {});
  }, []);

  async function select(model: string) {
    if (model === current) { setOpen(false); return; }
    setLoading(true);
    try {
      await fetch(`${API}/config/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setCurrent(model);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  const info = MODEL_LABELS[current] ?? { label: current, hint: "" };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-mono border border-[#1e1e26] rounded px-2 py-1 bg-gray-900/60 hover:bg-gray-800/60 transition-colors"
        title={`Active model: ${current}`}
      >
        {/* Gemini spark icon */}
        <svg viewBox="0 0 24 24" className="w-3 h-3 text-purple-400 fill-current" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
        </svg>
        <span className="text-purple-300">{info.label}</span>
        {loading ? (
          <span className="w-2 h-2 border border-purple-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 text-gray-500 fill-current">
            <path d="M8 10.94L3.06 6l.94-.94L8 9.06l4-4 .94.94L8 10.94z" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-[#1e1e26] bg-gray-900 shadow-xl overflow-hidden">
            {available.map((m) => {
              const mi = MODEL_LABELS[m] ?? { label: m, hint: "" };
              const active = m === current;
              return (
                <button
                  key={m}
                  onClick={() => select(m)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                    active ? "bg-purple-950/40" : "hover:bg-gray-800/60"
                  }`}
                >
                  <div className="mt-0.5 w-3 h-3 shrink-0">
                    {active && (
                      <svg viewBox="0 0 16 16" className="w-3 h-3 text-purple-400 fill-current">
                        <path d="M6.5 11.5L3 8l1-1 2.5 2.5 5-5 1 1-6 6z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className={`text-[11px] font-mono font-medium ${active ? "text-purple-300" : "text-gray-300"}`}>
                      {mi.label}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{mi.hint}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
