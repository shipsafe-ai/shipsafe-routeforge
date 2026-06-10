"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, FileCode } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";

interface DiffFile {
  old_path: string;
  new_path: string;
  diff: string;
}

interface ParsedLine {
  type: "add" | "remove" | "context" | "hunk";
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

function parseDiff(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split("\n")) {
    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]) - 1;
      newLine = parseInt(hunkMatch[2]) - 1;
      lines.push({ type: "hunk", oldLine: null, newLine: null, content: raw });
      continue;
    }
    if (raw.startsWith("---") || raw.startsWith("+++")) continue;

    if (raw.startsWith("+")) {
      newLine++;
      lines.push({ type: "add", oldLine: null, newLine, content: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      oldLine++;
      lines.push({ type: "remove", oldLine, newLine: null, content: raw.slice(1) });
    } else {
      oldLine++;
      newLine++;
      lines.push({ type: "context", oldLine, newLine, content: raw.slice(1) });
    }
  }
  return lines;
}

function LineNum({ n }: { n: number | null }) {
  return (
    <span className="select-none text-right pr-2 text-gray-600 tabular-nums w-8 flex-shrink-0 text-xs leading-5">
      {n ?? ""}
    </span>
  );
}

function FileDiff({ file, failingFunctions }: { file: DiffFile; failingFunctions: string[] }) {
  const lines = parseDiff(file.diff);

  return (
    <div className="mb-4 rounded-lg border border-gray-800 overflow-hidden">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <FileCode size={12} className="text-gray-500" />
        <span className="text-xs font-mono text-gray-400">{file.new_path}</span>
      </div>

      {/* Side-by-side table */}
      <div className="grid grid-cols-2 divide-x divide-gray-800 overflow-x-auto text-xs font-mono">
        {/* Left — old */}
        <div className="min-w-0">
          <div className="bg-gray-900/40 px-3 py-1 text-gray-600 text-xs border-b border-gray-800">before</div>
          {lines.map((line, i) => {
            if (line.type === "add") {
              return <div key={i} className="flex h-5" />;
            }
            const isHunk = line.type === "hunk";
            const isFailing = !isHunk && failingFunctions.some((fn) => line.content.includes(fn));
            return (
              <div
                key={i}
                className={`flex items-start leading-5 ${
                  isHunk
                    ? "bg-gray-900/60 text-gray-600"
                    : line.type === "remove"
                    ? "bg-red-950/40"
                    : "bg-transparent"
                } ${isFailing ? "ring-1 ring-inset ring-amber-700/60" : ""}`}
              >
                {!isHunk && <LineNum n={line.oldLine} />}
                <span
                  className={`flex-1 px-1 whitespace-pre overflow-hidden ${
                    line.type === "remove" ? "text-red-300" : "text-gray-400"
                  }`}
                >
                  {isHunk ? line.content : line.content || " "}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right — new */}
        <div className="min-w-0">
          <div className="bg-gray-900/40 px-3 py-1 text-gray-600 text-xs border-b border-gray-800">after</div>
          {lines.map((line, i) => {
            if (line.type === "remove") {
              return <div key={i} className="flex h-5" />;
            }
            const isHunk = line.type === "hunk";
            const isFailing = !isHunk && failingFunctions.some((fn) => line.content.includes(fn));
            return (
              <div
                key={i}
                className={`flex items-start leading-5 ${
                  isHunk
                    ? "bg-gray-900/60 text-gray-600"
                    : line.type === "add"
                    ? "bg-green-950/40"
                    : "bg-transparent"
                } ${isFailing ? "ring-1 ring-inset ring-amber-700/60" : ""}`}
              >
                {!isHunk && <LineNum n={line.newLine} />}
                <span
                  className={`flex-1 px-1 whitespace-pre overflow-hidden ${
                    line.type === "add" ? "text-green-300" : "text-gray-400"
                  }`}
                >
                  {isHunk ? line.content : line.content || " "}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DiffViewer({
  mrIid,
  failingFunctions = [],
}: {
  mrIid: number;
  failingFunctions?: string[];
}) {
  const { data, isLoading, error } = useQuery<DiffFile[]>({
    queryKey: ["diffs", mrIid],
    queryFn: async () => {
      const r = await fetch(`${API}/verdicts/${mrIid}/diffs`);
      if (!r.ok) throw new Error("Failed to fetch diffs");
      return r.json();
    },
    staleTime: Infinity,
  });

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-gray-500 text-xs py-3">
        <Loader2 size={12} className="animate-spin" /> Loading diff…
      </div>
    );
  if (error)
    return <p className="text-red-400 text-xs">Could not load diff.</p>;
  if (!data?.length)
    return <p className="text-gray-600 text-xs">No diff available.</p>;

  return (
    <div>
      {data.map((file) => (
        <FileDiff key={file.new_path} file={file} failingFunctions={failingFunctions} />
      ))}
    </div>
  );
}
