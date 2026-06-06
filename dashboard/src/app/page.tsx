import { VerdictFeed } from "@/components/VerdictFeed";
import { ChatPanel } from "@/components/ChatPanel";
import { StatsBar } from "@/components/StatsBar";
import { ScenarioEditor } from "@/components/ScenarioEditor";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-brand font-bold text-xl tracking-tight">RouteForge</span>
          <span className="text-xs text-gray-600 font-mono border border-gray-800 rounded px-1.5 py-0.5">v0.2</span>
        </div>
        <span className="text-gray-600 text-sm">AI Safety Gate for GitLab MRs</span>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          live
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <StatsBar />

        <div className="grid grid-cols-5 gap-5">
          {/* Verdict feed — wider */}
          <div className="col-span-3 space-y-0">
            <VerdictFeed />
          </div>

          {/* Right column: chat + scenario editor */}
          <div className="col-span-2 space-y-4">
            <div className="sticky top-6 space-y-4">
              <div className="h-[420px]">
                <ChatPanel />
              </div>
              <ScenarioEditor />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
