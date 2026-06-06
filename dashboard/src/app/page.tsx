import { VerdictFeed } from "@/components/VerdictFeed";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <span className="text-brand font-bold text-xl">RouteForge</span>
        <span className="text-gray-500 text-sm">AI Safety Gate for GitLab MRs</span>
      </header>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <VerdictFeed />
      </div>
    </main>
  );
}
