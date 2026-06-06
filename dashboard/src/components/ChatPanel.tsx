"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, Loader2, Bot, MessageSquare } from "lucide-react";

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
  text: "Ask me anything about RouteForge verdicts.\n\nTry: *\"explain the last BLOCK\"* or *\"what scenarios failed?\"*",
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

  const { data: verdicts = [] } = useQuery<VerdictSummary[]>({
    queryKey: ["verdicts"],
    queryFn: async () => {
      const r = await fetch(`${API}/verdicts`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
  });

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
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900/80">
        <div className="p-1 bg-brand/20 rounded">
          <Bot size={14} className="text-brand" />
        </div>
        <span className="text-sm font-semibold text-gray-200">Ask RouteForge</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          Gemini
        </span>
      </div>

      {/* MR selector */}
      {verdicts.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800/60 bg-gray-900/60">
          <select
            value={selectedMR ?? ""}
            onChange={(e) => setSelectedMR(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-brand/50"
          >
            <option value="">Context: all verdicts</option>
            {verdicts.map((v) => (
              <option key={v.mr_iid} value={v.mr_iid}>
                MR !{v.mr_iid}: {v.mr_title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <MessageSquare size={10} className="text-brand" />
              </div>
            )}
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-brand/20 text-gray-100 border border-brand/30 rounded-tr-sm"
                  : "bg-gray-800 text-gray-300 rounded-tl-sm"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {chat.isPending && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={10} className="text-brand" />
            </div>
            <div className="bg-gray-800 rounded-xl rounded-tl-sm px-4 py-2.5">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Quick suggestions */}
        {showSuggestions && messages.length === 1 && (
          <div className="pt-1 grid grid-cols-1 gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="text-left text-xs text-gray-400 bg-gray-800 hover:bg-gray-750 hover:text-gray-200 border border-gray-700 rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-3 border-t border-gray-800 bg-gray-900/80">
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
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand/50 transition-colors"
        />
        <button
          onClick={() => submit()}
          disabled={!input.trim() || chat.isPending}
          className="rounded-lg bg-brand hover:bg-orange-500 disabled:opacity-30 text-white px-3 py-1.5 transition-colors flex items-center justify-center"
        >
          {chat.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
