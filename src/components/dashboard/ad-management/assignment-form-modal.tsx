'use client';

import { useState } from 'react';

interface Creative {
  id: string;
  name: string;
  platform: string;
  format: string;
  version: number;
}

interface Variant {
  id: string;
  slug: string;
}

interface Vertical {
  id: string;
  name: string;
  slug: string;
  variants: Variant[];
}

interface AssignmentResult {
  utm_content_tag: string;
  assignment: unknown;
}

interface Props {
  open: boolean;
  onClose: () => void;
  creatives: Creative[];
  verticals: Vertical[];
  onSaved: (result: AssignmentResult) => void;
}

type Step = 'form' | 'result';

export function AssignmentFormModal({ open, onClose, creatives, verticals, onSaved }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [savedResult, setSavedResult] = useState<AssignmentResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [adCreativeId, setAdCreativeId] = useState(creatives[0]?.id ?? '');
  const [verticalId, setVerticalId] = useState(verticals[0]?.id ?? '');
  const [variantId, setVariantId] = useState<string>('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selectedVertical = verticals.find((v) => v.id === verticalId);
  const selectedCreative = creatives.find((c) => c.id === adCreativeId);

  function handleClose() {
    setStep('form');
    setSavedResult(null);
    setCopied(false);
    setAdCreativeId(creatives[0]?.id ?? '');
    setVerticalId(verticals[0]?.id ?? '');
    setVariantId('');
    setDailyBudget('');
    setNotes('');
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/ad-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad_creative_id: adCreativeId,
          vertical_id: verticalId,
          variant_id: variantId || null,
          daily_budget: dailyBudget ? Number(dailyBudget) : null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ? String(data.error) : 'Failed to create assignment');
        return;
      }

      const result = await res.json() as AssignmentResult;
      setSavedResult(result);
      setStep('result');
      onSaved(result);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!savedResult) return;
    try {
      await navigator.clipboard.writeText(savedResult.utm_content_tag);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — silently ignore
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">
            {step === 'form' ? 'New Ad Assignment' : 'Assignment Created'}
          </h2>
          <button
            onClick={handleClose}
            className="text-zinc-500 hover:text-white transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {step === 'result' && savedResult ? (
          <div className="space-y-5">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
              <p className="text-green-400 font-medium text-sm mb-1">Assignment created successfully</p>
              <p className="text-zinc-400 text-xs">Your UTM content tag has been generated below.</p>
            </div>

            <div>
              <p className="text-xs text-zinc-400 mb-2">UTM Content Tag</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-amber-400 font-mono break-all">
                  {savedResult.utm_content_tag}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-zinc-600 text-xs mt-2">
                Add this as the <code className="text-zinc-500">utm_content</code> parameter in your ad link.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleClose}
                className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Ad Creative */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Ad Creative *</label>
              {creatives.length === 0 ? (
                <p className="text-zinc-500 text-sm bg-zinc-800 border border-white/10 rounded-lg px-3 py-2">
                  No creatives yet — create one first.
                </p>
              ) : (
                <select
                  value={adCreativeId}
                  onChange={(e) => setAdCreativeId(e.target.value)}
                  required
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
                >
                  {creatives.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.platform.charAt(0).toUpperCase() + c.platform.slice(1)} – {c.name} v{c.version}
                    </option>
                  ))}
                </select>
              )}
              {selectedCreative && (
                <p className="text-zinc-600 text-xs mt-1">
                  {selectedCreative.format} format · version {selectedCreative.version}
                </p>
              )}
            </div>

            {/* Vertical */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Vertical *</label>
              {verticals.length === 0 ? (
                <p className="text-zinc-500 text-sm bg-zinc-800 border border-white/10 rounded-lg px-3 py-2">
                  No verticals yet — create a project with verticals first.
                </p>
              ) : (
                <select
                  value={verticalId}
                  onChange={(e) => {
                    setVerticalId(e.target.value);
                    setVariantId('');
                  }}
                  required
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
                >
                  {verticals.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Variant */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Variant</label>
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
              >
                <option value="">All variants</option>
                {(selectedVertical?.variants ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.slug}</option>
                ))}
              </select>
              <p className="text-zinc-600 text-xs mt-1">
                Leave as "All variants" to assign this creative to the whole vertical.
              </p>
            </div>

            {/* Daily Budget */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Daily Budget (optional)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  placeholder="0.00"
                  className="bg-zinc-800 border border-white/10 rounded-lg pl-7 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any context about this assignment..."
                rows={2}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full resize-none"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="border border-white/20 hover:border-white/40 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !adCreativeId || !verticalId || creatives.length === 0 || verticals.length === 0}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {loading ? 'Creating…' : 'Create Assignment'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
