"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical, Plus, Trash2, Edit2, Sparkles,
  Loader2, X, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  const qc = useQueryClient();

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
    <div className="space-y-3 bg-gray-900 border border-gray-700 rounded-lg p-4">
      {/* AI Generate */}
      <div>
        <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
          <Sparkles size={11} className="text-brand" /> Generate with Gemini
        </p>
        <div className="flex gap-2">
          <input
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            placeholder="e.g. Suez Canal blockage, reroute via Cape of Good Hope"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand/50"
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !generatePrompt.trim()}
            className="rounded bg-brand/20 hover:bg-brand/30 border border-brand/40 text-brand px-3 py-1.5 text-xs font-medium flex items-center gap-1 disabled:opacity-40"
          >
            {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Generate
          </button>
        </div>
      </div>

      <div className="border-t border-gray-800" />

      {/* Scenario ID */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">scenario_id</label>
        <input
          value={form.scenario_id ?? ""}
          onChange={(e) => set("scenario_id", e.target.value)}
          placeholder="hormuz_crisis_03"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-brand/50"
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">description</label>
        <input
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="LNG tanker, full Hormuz blockade..."
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-brand/50"
        />
      </div>

      {/* Row: strait + cargo */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">strait</label>
          <select
            value={form.strait_id ?? "hormuz"}
            onChange={(e) => set("strait_id", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none"
          >
            {["hormuz", "suez", "malacca", "panama", "bosphorus", "none"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">cargo</label>
          <select
            value={form.cargo_type ?? "container"}
            onChange={(e) => set("cargo_type", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none"
          >
            {["container", "LNG", "crude_oil", "bulk"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex flex-wrap gap-4">
        {[
          ["crisis_mode", "Crisis mode"],
          ["expected_blocked", "Expect blocked"],
          ["expected_rerouted", "Expect rerouted"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
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
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={isSaving || !form.scenario_id}
          className="rounded bg-brand hover:bg-orange-500 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
        >
          {isSaving && <Loader2 size={11} className="animate-spin" />}
          <Check size={11} /> Save
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
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-300">{scenario.scenario_id}</span>
          {scenario.crisis_mode && (
            <span className="text-xs bg-red-950/50 border border-red-900/50 text-red-400 px-1.5 py-0 rounded">crisis</span>
          )}
          <span className="text-xs text-gray-600">{scenario.strait_id}</span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">{scenario.description}</p>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button onClick={onEdit} className="p-1 text-gray-600 hover:text-gray-300 transition-colors">
          <Edit2 size={12} />
        </button>
        <button onClick={onDelete} className="p-1 text-gray-600 hover:text-red-400 transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export function ScenarioEditor() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // scenario_id or "new"
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

  const editingScenario = editing && editing !== "new"
    ? scenarios.find((s) => s.scenario_id === editing)
    : undefined;

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-900 hover:bg-gray-850 transition-colors text-left"
      >
        <FlaskConical size={14} className="text-brand" />
        <span className="text-sm font-medium text-gray-200">Scenario Library</span>
        <span className="text-xs text-gray-600 ml-1">{scenarios.length} scenarios</span>
        <div className="ml-auto text-gray-600">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-gray-800"
          >
            <div className="p-3 space-y-2 bg-gray-950">
              {isLoading && (
                <div className="flex items-center gap-2 text-gray-500 text-xs py-2">
                  <Loader2 size={12} className="animate-spin" /> Loading…
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
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 hover:border-gray-600 rounded-lg py-2 transition-colors"
                >
                  <Plus size={12} /> Add scenario
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
