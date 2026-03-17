'use client';

import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (project: { id: string }) => void;
}

const FUNNEL_OPTIONS = [
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'activation', label: 'Activation' },
  { value: 'monetization', label: 'Monetization' },
  { value: 'retention', label: 'Retention' },
  { value: 'referral', label: 'Referral' },
];

/** Amplitude events available for project-level tracking. */
const AMPLITUDE_EVENTS = [
  {
    name: 'Page View',
    label: 'Page View',
    description: 'Anonymous and authenticated page views',
    category: 'Acquisition',
  },
  {
    name: 'User Signed Up',
    label: 'User Signed Up',
    description: 'A new user registered an account',
    category: 'Acquisition',
  },
  {
    name: 'Movie Created',
    label: 'Movie Created',
    description: 'User created a movie',
    category: 'Activation',
  },
  {
    name: 'Channel Created',
    label: 'Channel Created',
    description: 'User created a channel',
    category: 'Activation',
  },
  {
    name: 'Credits Purchased',
    label: 'Credit Package Purchased',
    description: 'A user purchased a credit package',
    category: 'Monetization',
  },
];

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [funnelFocus, setFunnelFocus] = useState('acquisition');
  const [sigThreshold, setSigThreshold] = useState(95);
  const [description, setDescription] = useState('');
  const [startEvent, setStartEvent] = useState('');
  const [endEvent, setEndEvent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          funnel_focus: funnelFocus,
          significance_threshold: sigThreshold / 100,
          description: description || undefined,
          tracked_events: [startEvent, endEvent],
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ? String(data.error) : 'Failed to create project');
        return;
      }

      const project = await res.json() as { id: string };
      onCreated(project);
      // Reset form
      setName('');
      setFunnelFocus('acquisition');
      setSigThreshold(95);
      setDescription('');
      setStartEvent('');
      setEndEvent('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Project Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q1 Acquisition Push"
              required
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Funnel Focus *</label>
            <select
              value={funnelFocus}
              onChange={(e) => setFunnelFocus(e.target.value)}
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
            >
              {FUNNEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Conversion Events */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">
              Conversion Funnel — <span className="text-amber-400 font-medium">{startEvent && endEvent ? '2 events selected' : startEvent || endEvent ? '1 event selected' : 'select 2 events'}</span>
            </label>
            <p className="text-zinc-600 text-xs mb-3">
              Pick a starting event and an end event. Success is measured by the conversion ratio between them. Page URL differentiates variants.
            </p>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-500 font-medium mb-1.5 uppercase tracking-wider">Starting Event</p>
                <select
                  value={startEvent}
                  onChange={(e) => setStartEvent(e.target.value)}
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 w-full"
                >
                  <option value="" disabled>Select starting event...</option>
                  {AMPLITUDE_EVENTS.map((ev) => (
                    <option key={ev.name} value={ev.name} disabled={ev.name === endEvent}>
                      {ev.label} — {ev.description}
                    </option>
                  ))}
                </select>
              </div>

              {startEvent && (
                <div className="flex items-center gap-2 px-3">
                  <div className="flex-1 border-t border-dashed border-zinc-700" />
                  <span className="text-xs text-zinc-500">converts to</span>
                  <div className="flex-1 border-t border-dashed border-zinc-700" />
                </div>
              )}

              <div>
                <p className="text-xs text-zinc-500 font-medium mb-1.5 uppercase tracking-wider">End Event</p>
                <select
                  value={endEvent}
                  onChange={(e) => setEndEvent(e.target.value)}
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 w-full"
                >
                  <option value="" disabled>Select end event...</option>
                  {AMPLITUDE_EVENTS.map((ev) => (
                    <option key={ev.name} value={ev.name} disabled={ev.name === startEvent}>
                      {ev.label} — {ev.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Significance Threshold — <span className="text-amber-400 font-medium">{sigThreshold}% confidence required</span>
            </label>
            <input
              type="range"
              min={80}
              max={99}
              value={sigThreshold}
              onChange={(e) => setSigThreshold(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>80%</span>
              <span>99%</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this project's goals"
              rows={2}
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full resize-none"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="border border-white/20 hover:border-white/40 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !startEvent || !endEvent}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
