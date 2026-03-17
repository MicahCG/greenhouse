'use client';

import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSaved: (creative: { id: string; name: string }) => void;
}

const PLATFORM_OPTIONS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' },
  { value: 'linkedin', label: 'LinkedIn' },
];

const FORMAT_OPTIONS_BY_PLATFORM: Record<string, { value: string; label: string }[]> = {
  meta: [
    { value: 'video', label: 'Video' },
    { value: 'image', label: 'Image' },
    { value: 'carousel', label: 'Carousel' },
    { value: 'story', label: 'Story' },
    { value: 'reel', label: 'Reel' },
  ],
  google: [
    { value: 'text', label: 'Text' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: 'responsive', label: 'Responsive' },
  ],
  linkedin: [
    { value: 'video', label: 'Video' },
    { value: 'image', label: 'Image' },
    { value: 'text', label: 'Text' },
    { value: 'carousel', label: 'Carousel' },
  ],
};

export function CreativeFormModal({ open, onClose, projectId, onSaved }: Props) {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('meta');
  const [format, setFormat] = useState('video');
  const [copyHeadline, setCopyHeadline] = useState('');
  const [copyBody, setCopyBody] = useState('');
  const [copyCta, setCopyCta] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [platformCampaignId, setPlatformCampaignId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const formatOptions = FORMAT_OPTIONS_BY_PLATFORM[platform] ?? FORMAT_OPTIONS_BY_PLATFORM.meta;

  function handlePlatformChange(newPlatform: string) {
    setPlatform(newPlatform);
    const formats = FORMAT_OPTIONS_BY_PLATFORM[newPlatform] ?? [];
    setFormat(formats[0]?.value ?? 'video');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/ad-creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          name,
          platform,
          format,
          copy_headline: copyHeadline || undefined,
          copy_body: copyBody || undefined,
          copy_cta: copyCta || undefined,
          media_url: mediaUrl || undefined,
          platform_campaign_id: platformCampaignId || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ? String(data.error) : 'Failed to create ad creative');
        return;
      }

      const creative = await res.json() as { id: string; name: string };
      // Reset form
      setName('');
      setPlatform('meta');
      setFormat('video');
      setCopyHeadline('');
      setCopyBody('');
      setCopyCta('');
      setMediaUrl('');
      setPlatformCampaignId('');
      setNotes('');
      onSaved(creative);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Ad Creative</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q1 Hero Video — Creators"
              required
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* Platform + Format row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Platform *</label>
              <select
                value={platform}
                onChange={(e) => handlePlatformChange(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
              >
                {PLATFORM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Format *</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full"
              >
                {formatOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Copy Headline */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Headline</label>
            <input
              type="text"
              value={copyHeadline}
              onChange={(e) => setCopyHeadline(e.target.value)}
              placeholder="e.g. Grow your audience faster"
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* Copy Body */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Body Copy</label>
            <textarea
              value={copyBody}
              onChange={(e) => setCopyBody(e.target.value)}
              placeholder="The main body text for your ad..."
              rows={3}
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full resize-none"
            />
          </div>

          {/* CTA */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">CTA Text</label>
            <input
              type="text"
              value={copyCta}
              onChange={(e) => setCopyCta(e.target.value)}
              placeholder="e.g. Get Started Free"
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* Media URL */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Media URL (optional)</label>
            <input
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://..."
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* Platform Campaign ID */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {platform === 'google' ? 'Google Ads Campaign ID' : platform === 'meta' ? 'Meta Campaign ID' : 'Platform Campaign ID'} (optional)
            </label>
            <input
              type="text"
              value={platformCampaignId}
              onChange={(e) => setPlatformCampaignId(e.target.value)}
              placeholder={platform === 'google' ? 'e.g. 1234567890' : 'Campaign ID from ad platform'}
              className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full font-mono"
            />
            <p className="text-zinc-600 text-xs mt-1">Links this creative to a specific campaign for spend parity tracking.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context or notes about this creative..."
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
              onClick={onClose}
              className="border border-white/20 hover:border-white/40 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Creating…' : 'Create Creative'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
