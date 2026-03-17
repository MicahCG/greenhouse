'use client';

import { useState, useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const STRATEGY_OPTIONS = [
  { value: 'equal', label: 'Equal Split', desc: 'Traffic split evenly across all active variants' },
  { value: 'weighted', label: 'Weighted', desc: 'You control each variant\'s traffic allocation manually' },
  { value: 'champion_challenger', label: 'Champion / Challenger', desc: 'Champion gets 80%, challengers split the remaining 20%' },
];

export function CreateVerticalModal({ open, onClose, projectId, onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [strategy, setStrategy] = useState('equal');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugEdited) {
      setSlug(generateSlug(name));
    }
  }, [name, slugEdited]);

  if (!open) return null;

  function handleSlugChange(val: string) {
    setSlugEdited(true);
    setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/verticals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
          source_url: sourceUrl || undefined,
          source_file: sourceFile || undefined,
          traffic_split_strategy: strategy,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ? String(data.error) : 'Failed to create vertical');
        return;
      }

      onCreated();
      setName('');
      setSlug('');
      setSlugEdited(false);
      setDescription('');
      setSourceUrl('');
      setSourceFile('');
      setStrategy('equal');
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
          <h2 className="text-lg font-semibold">New Vertical</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Content Creators"
              required
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Slug (URL path)</label>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-sm">/lp/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="content-creators"
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 flex-1 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What audience does this vertical target?"
              rows={2}
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full resize-none"
            />
          </div>

          <div className="border-t border-white/5 pt-4">
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-3">Source Page (optional)</p>
            <p className="text-xs text-zinc-600 mb-3">Link this vertical to an existing page in your codebase. This enables fork-based variant creation — duplicate the page with copy changes in one click.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Source URL</label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://www.popcorn.co/credits"
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Source File (GitHub path)</label>
                <input
                  type="text"
                  value={sourceFile}
                  onChange={(e) => setSourceFile(e.target.value)}
                  placeholder="app/(sidebar)/credits/page.tsx"
                  className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-2">Traffic Split Strategy</label>
            <div className="space-y-2">
              {STRATEGY_OPTIONS.map((opt) => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${strategy === opt.value ? 'border-amber-500/50 bg-amber-500/5' : 'border-white/10 hover:border-white/20'}`}>
                  <input
                    type="radio"
                    name="strategy"
                    value={opt.value}
                    checked={strategy === opt.value}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-white">{opt.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
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
              disabled={loading || !name.trim()}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Creating…' : 'Create Vertical'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
