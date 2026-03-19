'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProjectSettingsProps {
  projectId: string;
  currentEvents: string[];
  currentDescription: string;
  currentThreshold: number;
}

const COMMON_EVENTS = [
  'Viewed',
  'User Signed Up',
  'Channel Created',
  'Credits Purchased',
  'Movie Created',
  'lp_page_viewed',
  'lp_cta_clicked',
];

export function ProjectSettings({ projectId, currentEvents, currentDescription, currentThreshold }: ProjectSettingsProps) {
  const [open, setOpen] = useState(false);
  const [startEvent, setStartEvent] = useState(currentEvents[0] ?? '');
  const [endEvent, setEndEvent] = useState(currentEvents[1] ?? '');
  const [description, setDescription] = useState(currentDescription);
  const [threshold, setThreshold] = useState(currentThreshold);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (startEvent && endEvent) body.tracked_events = [startEvent, endEvent];
      if (description !== currentDescription) body.description = description;
      if (threshold !== currentThreshold) body.significance_threshold = threshold;

      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded hover:bg-white/5"
      >
        Settings
      </button>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl bg-zinc-900 p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project Settings</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          Cancel
        </button>
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this project measures"
          className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Start Event (visitors)</label>
          <select
            value={startEvent}
            onChange={(e) => setStartEvent(e.target.value)}
            className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
          >
            <option value="">Select event...</option>
            {COMMON_EVENTS.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-600 mt-1">The event that counts as a &quot;visit&quot;</p>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">End Event (conversions)</label>
          <select
            value={endEvent}
            onChange={(e) => setEndEvent(e.target.value)}
            className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
          >
            <option value="">Select event...</option>
            {COMMON_EVENTS.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-600 mt-1">The event that counts as a &quot;conversion&quot;</p>
        </div>
      </div>

      {startEvent && endEvent && (
        <div className="bg-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-400">
          Funnel: <span className="text-white font-medium">{startEvent}</span> → <span className="text-white font-medium">{endEvent}</span>
        </div>
      )}

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Significance Threshold</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={80}
            max={99}
            value={Math.round(threshold * 100)}
            onChange={(e) => setThreshold(Number(e.target.value) / 100)}
            className="flex-1"
          />
          <span className="text-sm text-white font-medium w-12 text-right">{Math.round(threshold * 100)}%</span>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || (!startEvent || !endEvent)}
        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
