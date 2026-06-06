"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-o34wppiwiq-uc.a.run.app";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface VerdictSummary {
  mr_iid: number;
  mr_title: string;
}

async function sendChat(payload: { message: string; mr_iid?: number }): Promise<{ response: string }> {
  const r = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Chat failed: ${r.status}`);
  return r.json();
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  text: "Ask me anything about RouteForge verdicts.\n\nTry: \"explain the last BLOCK\" or \"what scenarios failed?\"",
};

const SUGGESTIONS = [
  "Explain the last BLOCK",
  "What scenarios failed?",
  "What should the developer fix?",
  "What is RouteForge?",
];

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [selectedMR, setSelectedMR] = useState<number | undefined>(undefined);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: verdicts = [] } = useQuery<VerdictSummary[]>({
    queryKey: ["verdicts"],
    queryFn: async () => {
      const r = await fetch(`${API}/verdicts`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const chat = useMutation({
    mutationFn: (message: string) =>
      sendChat({ message, mr_iid: selectedMR }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", text: data.response }]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Error reaching RouteForge. Check the API connection." },
      ]);
    },
  });

  function submit(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || chat.isPending) return;
    setShowSuggestions(false);
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setInput("");
    chat.mutate(msg);
  }

  return (
    <div className="flex flex-col h-full bg-[#111215] rounded-lg border border-[#1e1e26] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1e1e26]">
        <span className="text-[11px] text-gray-500 uppercase tracking-wide font-mono">ask routeforge</span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-600 font-mono">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          gemini
        </div>
      </div>

      {/* MR selector */}
      {verdicts.length > 0 && (
        <div className="px-3 py-2 border-b border-[#1e1e26]">
          <select
            value={selectedMR ?? ""}
            onChange={(e) => setSelectedMR(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-[#16161b] border border-[#1e1e26] rounded px-2 py-1 text-[11px] font-mono text-gray-400 focus:outline-none focus:border-brand/40 transition-colors"
          >
            <option value="">context: all verdicts</option>
            {verdicts.map((v) => (
              <option key={v.mr_iid} value={v.mr_iid}>
                !{v.mr_iid} — {v.mr_title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] px-3 py-2 rounded text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[#16161b] border border-brand/30 text-gray-200 border-l-2 border-l-brand/60"
                  : "text-gray-300"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {chat.isPending && (
          <div className="flex justify-start">
            <div className="px-3 py-2 text-gray-600">
              <div className="flex gap-1 items-center">
                <span className="w-1 h-1 bg-gray-600 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 bg-gray-600 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-gray-600 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Quick suggestions */}
        {showSuggestions && messages.length === 1 && (
          <div className="pt-1 space-y-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="w-full text-left text-[11px] text-gray-500 hover:text-gray-300 border border-[#1e1e26] hover:border-[#2a2a35] rounded px-3 py-1.5 transition-colors font-mono"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-2.5 border-t border-[#1e1e26]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about a verdict..."
          className="flex-1 bg-[#16161b] border border-[#1e1e26] rounded px-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-700 focus:outline-none focus:border-brand/40 transition-colors"
        />
        <button
          onClick={() => submit()}
          disabled={!input.trim() || chat.isPending}
          className="rounded bg-brand hover:bg-brand-600 disabled:opacity-25 text-white px-3 py-1.5 transition-colors flex items-center justify-center"
        >
          {chat.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
        </button>
      </div>
    </div>
  );
}
