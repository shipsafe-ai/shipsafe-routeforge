"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical, Plus, Trash2, Edit2, Sparkles,
  Loader2, Check, ChevronDown, ChevronRight,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://routeforge-336382452417.us-central1.run.app";
const DEFAULT_PROJECT = process.env.NEXT_PUBLIC_GITLAB_PROJECT_ID ?? "82762386";

interface Scenario {
  scenario_id: string;
  description: string;
  crisis_mode: boolean;
  strait_id: string;
  expected_blocked: boolean;
  expected_rerouted: boolean;
  cargo_type: string;
  tags: string[];
}

const BLANK: Omit<Scenario, "scenario_id"> = {
  description: "",
  crisis_mode: false,
  strait_id: "hormuz",
  expected_blocked: false,
  expected_rerouted: false,
  cargo_type: "container",
  tags: [],
};

async function fetchScenarios(projectId: string): Promise<Scenario[]> {
  const r = await fetch(`${API}/scenarios/${projectId}`);
  if (!r.ok) throw new Error("Failed to load scenarios");
  return r.json();
}

async function createScenario(projectId: string, data: Partial<Scenario>): Promise<Scenario> {
  const r = await fetch(`${API}/scenarios/${projectId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function updateScenario(projectId: string, id: string, data: Partial<Scenario>): Promise<Scenario> {
  const r = await fetch(`${API}/scenarios/${projectId}/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function deleteScenario(projectId: string, id: string): Promise<void> {
  const r = await fetch(`${API}/scenarios/${projectId}/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

async function generateScenario(projectId: string, description: string): Promise<Scenario> {
  const r = await fetch(`${API}/scenarios/${projectId}/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const labelClass = "text-[10px] text-gray-600 uppercase tracking-wide font-mono block mb-1";
const inputClass = "w-full bg-[#16161b] border border-[#1e1e26] rounded px-2 py-1.5 text-[11px] text-gray-300 focus:outline-none focus:border-brand/40 transition-colors";
const selectClass = `${inputClass} font-mono`;

function ScenarioForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: Partial<Scenario>;
  onSave: (data: Partial<Scenario>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<Scenario>>({ ...BLANK, ...initial });
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  function set(key: keyof Scenario, val: unknown) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  async function handleGenerate() {
    if (!generatePrompt.trim()) return;
    setGenerating(true);
    try {
      const generated = await generateScenario(DEFAULT_PROJECT, generatePrompt);
      setForm(generated);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3 bg-[#111215] border border-[#1e1e26] rounded-lg p-3">
      {/* AI Generate */}
      <div>
        <label className={labelClass}>
          <Sparkles size={9} className="inline text-brand mr-1" />
          generate with gemini
        </label>
        <div className="flex gap-2">
          <input
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            placeholder="e.g. Suez Canal blockage, reroute via Cape of Good Hope"
            className={`${inputClass} flex-1`}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !generatePrompt.trim()}
            className="rounded border border-brand/30 text-brand hover:bg-brand/10 px-2.5 py-1.5 text-[11px] font-mono flex items-center gap-1 disabled:opacity-40 transition-colors"
          >
            {generating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          </button>
        </div>
      </div>

      <div className="border-t border-[#1e1e26]" />

      {/* scenario_id */}
      <div>
        <label className={labelClass}>scenario_id</label>
        <input
          value={form.scenario_id ?? ""}
          onChange={(e) => set("scenario_id", e.target.value)}
          placeholder="hormuz_crisis_03"
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* description */}
      <div>
        <label className={labelClass}>description</label>
        <input
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="LNG tanker, full Hormuz blockade..."
          className={inputClass}
        />
      </div>

      {/* strait + cargo */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>strait</label>
          <select
            value={form.strait_id ?? "hormuz"}
            onChange={(e) => set("strait_id", e.target.value)}
            className={selectClass}
          >
            {["hormuz", "suez", "malacca", "panama", "bosphorus", "none"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>cargo</label>
          <select
            value={form.cargo_type ?? "container"}
            onChange={(e) => set("cargo_type", e.target.value)}
            className={selectClass}
          >
            {["container", "LNG", "crude_oil", "bulk"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex flex-wrap gap-3">
        {[
          ["crisis_mode", "crisis"],
          ["expected_blocked", "expect block"],
          ["expected_rerouted", "expect reroute"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-[11px] text-gray-500 font-mono cursor-pointer hover:text-gray-300 transition-colors">
            <input
              type="checkbox"
              checked={!!form[key as keyof Scenario]}
              onChange={(e) => set(key as keyof Scenario, e.target.checked)}
              className="accent-brand"
            />
            {label}
          </label>
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-0.5">
        <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-gray-600 hover:text-gray-300 transition-colors font-mono">
          cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={isSaving || !form.scenario_id}
          className="rounded bg-brand hover:bg-brand-600 disabled:opacity-30 text-white px-3 py-1.5 text-[11px] font-mono flex items-center gap-1.5 transition-colors"
        >
          {isSaving && <Loader2 size={10} className="animate-spin" />}
          <Check size={10} /> save
        </button>
      </div>
    </div>
  );
}

function ScenarioRow({
  scenario,
  onEdit,
  onDelete,
}: {
  scenario: Scenario;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 bg-[#111215] rounded border border-[#1e1e26] hover:border-[#2a2a35] transition-colors ${
      scenario.crisis_mode ? "border-l-2 border-l-red-500/40" : ""
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-gray-300">{scenario.scenario_id}</span>
          <span className="text-[10px] text-gray-600 font-mono">{scenario.strait_id}</span>
          {scenario.crisis_mode && (
            <span className="text-[9px] font-mono text-red-500/70 uppercase tracking-wide">crisis</span>
          )}
        </div>
        <p className="text-[10px] text-gray-600 truncate mt-0.5">{scenario.description}</p>
      </div>
      <div className="flex gap-0.5 flex-shrink-0">
        <button onClick={onEdit} className="p-1.5 text-gray-700 hover:text-gray-400 transition-colors">
          <Edit2 size={11} />
        </button>
        <button onClick={onDelete} className="p-1.5 text-gray-700 hover:text-red-500/70 transition-colors">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export function ScenarioEditor() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const qc = useQueryClient();
  const key = ["scenarios", DEFAULT_PROJECT];

  const { data: scenarios = [], isLoading } = useQuery<Scenario[]>({
    queryKey: key,
    queryFn: () => fetchScenarios(DEFAULT_PROJECT),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (data: Partial<Scenario>) => createScenario(DEFAULT_PROJECT, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setEditing(null); },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Scenario> }) =>
      updateScenario(DEFAULT_PROJECT, id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setEditing(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteScenario(DEFAULT_PROJECT, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  function handleSave(data: Partial<Scenario>) {
    if (editing === "new") {
      create.mutate(data);
    } else if (editing) {
      update.mutate({ id: editing, data });
    }
  }

  return (
    <div className="border border-[#1e1e26] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-[#111215] hover:bg-[#16161b] transition-colors text-left"
      >
        <FlaskConical size={13} className="text-brand flex-shrink-0" />
        <span className="text-[11px] font-mono text-gray-400">scenario library</span>
        {scenarios.length > 0 && (
          <span className="text-[10px] text-gray-700 font-mono">{scenarios.length}</span>
        )}
        <div className="ml-auto text-gray-700">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#1e1e26] p-2.5 space-y-1.5 bg-[#0d0d10]">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-600 text-[11px] py-2 font-mono">
              <Loader2 size={11} className="animate-spin" /> loading…
            </div>
          )}

          {scenarios.map((s) =>
            editing === s.scenario_id ? (
              <ScenarioForm
                key={s.scenario_id}
                initial={s}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                isSaving={update.isPending}
              />
            ) : (
              <ScenarioRow
                key={s.scenario_id}
                scenario={s}
                onEdit={() => setEditing(s.scenario_id)}
                onDelete={() => remove.mutate(s.scenario_id)}
              />
            )
          )}

          {editing === "new" && (
            <ScenarioForm
              initial={{}}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              isSaving={create.isPending}
            />
          )}

          {editing === null && (
            <button
              onClick={() => setEditing("new")}
              className="w-full flex items-center justify-center gap-1.5 text-[10px] text-gray-700 hover:text-gray-400 border border-dashed border-[#1e1e26] hover:border-[#2a2a35] rounded py-2 font-mono transition-colors"
            >
              <Plus size={10} /> add scenario
            </button>
          )}
        </div>
      )}
    </div>
  );
}
