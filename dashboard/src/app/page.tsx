import { VerdictFeed } from "@/components/VerdictFeed";
import { ChatPanel } from "@/components/ChatPanel";
import { StatsBar } from "@/components/StatsBar";
import { ScenarioEditor } from "@/components/ScenarioEditor";
import { TrendPanel } from "@/components/TrendPanel";
import { ModelSelector } from "@/components/ModelSelector";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-[#1e1e26] px-6 py-3.5 flex items-center gap-4 overflow-visible relative z-10">
        <a href="https://shipsafe-landing-o34wppiwiq-uc.a.run.app"
           className="text-xs font-mono text-gray-600 hover:text-gray-400 transition-colors"
           style={{ textDecoration: 'none' }}>
          ← ShipSafe
        </a>
        <span className="text-[#1e1e26]">·</span>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-brand font-semibold text-base tracking-tight">RouteForge</span>
          <span className="text-[10px] text-gray-600 font-mono border border-[#1e1e26] rounded px-1.5 py-px">v0.2</span>
        </div>
        <span className="text-gray-600 text-xs border-l border-[#1e1e26] pl-4">AI Safety Gate · GitLab MRs</span>
        <div className="ml-auto flex items-center gap-3">
          <ModelSelector />
          <div className="flex items-center gap-1.5 text-[11px] text-gray-600 font-mono">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            live
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-5">
        <StatsBar />
        <TrendPanel />

        <div className="grid grid-cols-5 gap-5">
          <div className="col-span-3">
            <VerdictFeed />
          </div>
          <div className="col-span-2">
            <div className="sticky top-5 space-y-4">
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
