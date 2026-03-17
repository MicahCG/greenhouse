'use client';

import { useState, useCallback, useEffect } from 'react';
import type { VariantConfig } from '@/lib/types/variant-config';
import { VariantPreview } from '@/components/dashboard/variant-preview';
import type { ExtractedText } from '@/lib/agent/source-extractor';

interface ExistingVariant {
  id: string;
  slug: string;
  version: number;
  status: string;
  config: unknown;
  traffic_weight: number;
  variant_type?: string;
  external_url?: string | null;
}

type VariantType = 'fork' | 'template' | 'external_url';

interface VariantFormProps {
  verticalId: string;
  trafficSplitStrategy?: string;
  variant?: ExistingVariant;
  sourceFile?: string | null;
  sourceUrl?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

const inputClass = 'bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 w-full';
const labelClass = 'block text-xs text-zinc-400 mb-1';

function getInitialConfig(variant?: ExistingVariant): Partial<VariantConfig> {
  if (!variant?.config) {
    return {
      template: 'hero-centered',
      headline: '',
      subheadline: '',
      body_copy: '',
      cta_primary: { text: '', action: '' },
      meta_title: '',
      meta_description: '',
    };
  }
  const c = variant.config as Partial<VariantConfig>;
  return {
    template: c.template || 'hero-centered',
    headline: c.headline || '',
    subheadline: c.subheadline || '',
    body_copy: c.body_copy || '',
    cta_primary: c.cta_primary || { text: '', action: '' },
    cta_secondary: c.cta_secondary,
    hero_image: c.hero_image || '',
    social_proof: c.social_proof || [],
    meta_title: c.meta_title || '',
    meta_description: c.meta_description || '',
    og_image: c.og_image || '',
    theme: c.theme,
  };
}

export function VariantForm({ verticalId, trafficSplitStrategy, variant, sourceFile, sourceUrl, onSaved, onCancel }: VariantFormProps) {
  const initialType: VariantType = variant
    ? ((variant.variant_type as VariantType) ?? 'template')
    : (sourceFile ? 'fork' : 'template');
  const [variantType, setVariantType] = useState<VariantType>(initialType);
  // Fork / Variant Builder state
  const [forkRoute, setForkRoute] = useState('');
  const [forkHypothesis, setForkHypothesis] = useState('');
  const [forkDescription, setForkDescription] = useState('');
  const [forkResult, setForkResult] = useState<{ pr_url: string; pr_number: number; new_route: string } | null>(null);
  // Extracted content from source file
  const [extractedTexts, setExtractedTexts] = useState<ExtractedText[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<number, string>>({}); // line → edited value
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Auto-extract content when fork mode is selected and sourceFile is set
  useEffect(() => {
    if (variantType === 'fork' && sourceFile && extractedTexts.length === 0 && !extracting) {
      setExtracting(true);
      setExtractError(null);
      fetch(`/api/source-extract?repo=popcorn&path=${encodeURIComponent(sourceFile)}`)
        .then((res) => res.json())
        .then((data: { texts?: ExtractedText[]; error?: string }) => {
          if (data.error) {
            setExtractError(data.error);
          } else if (data.texts) {
            setExtractedTexts(data.texts);
          }
        })
        .catch(() => setExtractError('Failed to fetch source content'))
        .finally(() => setExtracting(false));
    }
  }, [variantType, sourceFile, extractedTexts.length, extracting]);

  // Build replacements from edited texts
  const forkReplacements = extractedTexts
    .filter((t) => editedTexts[t.line] !== undefined && editedTexts[t.line] !== t.text)
    .map((t) => ({ find: t.text, replace: editedTexts[t.line] }));
  const [config, setConfig] = useState<Partial<VariantConfig>>(() => getInitialConfig(variant));
  const [externalUrl, setExternalUrl] = useState(variant?.external_url ?? (variant?.config as Record<string, unknown>)?.external_url as string ?? '');
  const [externalLabel, setExternalLabel] = useState((variant?.config as Record<string, unknown>)?.label as string ?? '');
  const [trafficWeight, setTrafficWeight] = useState(variant?.traffic_weight ?? 50);
  const [changeDescription, setChangeDescription] = useState('');
  const [showSeo, setShowSeo] = useState(false);
  const [showSecondary, setShowSecondary] = useState(!!variant && !!(variant.config as Partial<VariantConfig>)?.cta_secondary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConfig = useCallback((patch: Partial<VariantConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const socialProofItems = config.social_proof ?? [];

  function addSocialProof() {
    updateConfig({ social_proof: [...socialProofItems, ''] });
  }

  function updateSocialProof(idx: number, val: string) {
    const updated = [...socialProofItems];
    updated[idx] = val;
    updateConfig({ social_proof: updated });
  }

  function removeSocialProof(idx: number) {
    updateConfig({ social_proof: socialProofItems.filter((_, i) => i !== idx) });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let res: Response;

      if (variantType === 'fork') {
        // Fork variant — calls the fork API
        if (!forkRoute.trim()) {
          setError('Route name is required');
          setLoading(false);
          return;
        }
        if (!forkHypothesis.trim()) {
          setError('Hypothesis is required');
          setLoading(false);
          return;
        }

        res = await fetch(`/api/verticals/${verticalId}/variants/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            new_route: forkRoute.trim(),
            text_replacements: forkReplacements.filter((r) => r.find.trim()),
            hypothesis: forkHypothesis.trim(),
            description: forkDescription.trim() || forkHypothesis.trim(),
          }),
        });

        if (!res.ok) {
          const data = await res.json() as { error?: unknown };
          const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
          setError(msg || 'Failed to fork page');
          return;
        }

        const result = await res.json() as { pr_url: string; pr_number: number; new_route: string };
        setForkResult(result);
        onSaved();
        return;
      }

      if (variantType === 'external_url') {
        // External URL variant
        if (!externalUrl) {
          setError('External URL is required');
          setLoading(false);
          return;
        }

        if (variant) {
          res = await fetch(`/api/variants/${variant.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              external_url: externalUrl,
              label: externalLabel || undefined,
              traffic_weight: trafficSplitStrategy === 'weighted' ? trafficWeight : undefined,
              change_description: changeDescription || undefined,
              changed_by: 'user',
            }),
          });
        } else {
          res = await fetch(`/api/verticals/${verticalId}/variants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variant_type: 'external_url',
              external_url: externalUrl,
              label: externalLabel || undefined,
              traffic_weight: trafficSplitStrategy === 'weighted' ? trafficWeight : undefined,
            }),
          });
        }
      } else {
        // Template variant
        const fullConfig: VariantConfig = {
          template: config.template || 'hero-centered',
          headline: config.headline || '',
          subheadline: config.subheadline || '',
          body_copy: config.body_copy || '',
          cta_primary: config.cta_primary || { text: 'Get Started', action: '#' },
          cta_secondary: showSecondary ? config.cta_secondary : undefined,
          hero_image: config.hero_image || undefined,
          social_proof: (config.social_proof ?? []).filter(Boolean),
          meta_title: config.meta_title || config.headline || 'Page',
          meta_description: config.meta_description || config.subheadline || '',
          og_image: config.og_image || undefined,
          theme: config.theme,
        };

        if (variant) {
          res = await fetch(`/api/variants/${variant.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: fullConfig,
              traffic_weight: trafficSplitStrategy === 'weighted' ? trafficWeight : undefined,
              change_description: changeDescription || undefined,
              changed_by: 'user',
            }),
          });
        } else {
          res = await fetch(`/api/verticals/${verticalId}/variants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: fullConfig,
              traffic_weight: trafficSplitStrategy === 'weighted' ? trafficWeight : undefined,
            }),
          });
        }
      }

      if (!res.ok) {
        const data = await res.json() as { error?: unknown };
        const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        setError(msg || 'Failed to save variant');
        return;
      }

      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Don't allow changing type on existing variant
  const canChangeType = !variant;

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex gap-6">
        {/* Left — form (60%) */}
        <div className="flex-[3] space-y-4 min-w-0">

          {/* Variant type toggle */}
          {canChangeType && (
            <div>
              <label className={labelClass}>Variant Type</label>
              <div className={`grid gap-3 ${sourceFile ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {sourceFile && (
                  <button
                    type="button"
                    onClick={() => setVariantType('fork')}
                    className={`border rounded-lg p-3 text-left transition-colors ${variantType === 'fork' ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/25 bg-zinc-800/50'}`}
                  >
                    <div className="text-lg mb-1">{'\u2442'}</div>
                    <p className="text-xs font-medium text-white">Fork Page</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Duplicate source page at a new route with changes</p>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVariantType('template')}
                  className={`border rounded-lg p-3 text-left transition-colors ${variantType === 'template' ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/25 bg-zinc-800/50'}`}
                >
                  <div className="text-lg mb-1">{'\u25A0'}</div>
                  <p className="text-xs font-medium text-white">Greenhouse Template</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Landing page built from config, hosted at /lp/...</p>
                </button>
                <button
                  type="button"
                  onClick={() => setVariantType('external_url')}
                  className={`border rounded-lg p-3 text-left transition-colors ${variantType === 'external_url' ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/25 bg-zinc-800/50'}`}
                >
                  <div className="text-lg mb-1">{'\u2197'}</div>
                  <p className="text-xs font-medium text-white">External URL</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Track an existing page (e.g. Popcorn app pages)</p>
                </button>
              </div>
            </div>
          )}

          {variantType === 'fork' ? (
            /* Variant Builder mode — extracted content editor */
            <div className="space-y-4">
              <div className="bg-zinc-800/50 border border-white/5 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Source file</p>
                  <p className="text-xs text-zinc-300 font-mono mt-0.5">{sourceFile}</p>
                </div>
                {sourceUrl && (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400/60 hover:text-blue-400">{'\u2197'}</a>
                )}
              </div>
              <div>
                <label className={labelClass}>New Route Name *</label>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-sm">/</span>
                  <input
                    type="text"
                    value={forkRoute}
                    onChange={(e) => setForkRoute(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())}
                    placeholder="credits2"
                    required
                    className={inputClass + ' font-mono'}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Hypothesis *</label>
                <input
                  type="text"
                  value={forkHypothesis}
                  onChange={(e) => setForkHypothesis(e.target.value)}
                  placeholder="A simpler pricing layout will increase purchase conversion"
                  required
                  className={inputClass}
                />
              </div>

              {/* Extracted page content — editable */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelClass.replace('mb-1', '')}>Page Content</label>
                  {forkReplacements.length > 0 && (
                    <span className="text-xs text-amber-400">{forkReplacements.length} change{forkReplacements.length !== 1 ? 's' : ''}</span>
                  )}
                </div>

                {extracting && (
                  <div className="text-xs text-zinc-500 animate-pulse py-4 text-center">Reading source file...</div>
                )}
                {extractError && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{extractError}</p>
                )}

                {extractedTexts.length > 0 && (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {extractedTexts.map((t) => {
                      const isEdited = editedTexts[t.line] !== undefined && editedTexts[t.line] !== t.text;
                      return (
                        <div key={`${t.line}-${t.text.slice(0, 20)}`} className={`rounded-lg px-3 py-2 transition-colors ${isEdited ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-zinc-800/50 border border-transparent'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-zinc-600 font-mono">{t.context}</span>
                            {t.elementType && <span className="text-[10px] text-zinc-700">&lt;{t.elementType}&gt;</span>}
                            <span className="text-[10px] text-zinc-700">L{t.line}</span>
                          </div>
                          <input
                            type="text"
                            value={editedTexts[t.line] ?? t.text}
                            onChange={(e) => setEditedTexts((prev) => ({ ...prev, [t.line]: e.target.value }))}
                            className={`bg-transparent border-0 text-sm w-full focus:outline-none ${isEdited ? 'text-amber-300' : 'text-zinc-300'}`}
                          />
                          {isEdited && (
                            <p className="text-xs text-red-400/60 line-through mt-0.5">{t.text}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!extracting && extractedTexts.length === 0 && !extractError && (
                  <p className="text-xs text-zinc-600 py-4 text-center">No source file set on this vertical</p>
                )}
              </div>
            </div>
          ) : variantType === 'external_url' ? (
            /* External URL mode */
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Target URL *</label>
                <input
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://popcorn.app/credit-store"
                  required
                  className={inputClass}
                />
                <p className="text-xs text-zinc-600 mt-1">The existing page this variant points to</p>
              </div>
              <div>
                <label className={labelClass}>Label (optional)</label>
                <input
                  type="text"
                  value={externalLabel}
                  onChange={(e) => setExternalLabel(e.target.value)}
                  placeholder="Credit Store — Default Layout"
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            /* Template mode */
            <>
              {/* Template selector */}
              <div>
                <label className={labelClass}>Template</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['hero-centered', 'hero-split'] as const).map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => updateConfig({ template: tpl })}
                      className={`border rounded-lg p-3 text-left transition-colors ${config.template === tpl ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 hover:border-white/25 bg-zinc-800/50'}`}
                    >
                      <div className="text-lg mb-1">{tpl === 'hero-centered' ? '\u25A0' : '\u25A0\u25A1'}</div>
                      <p className="text-xs font-medium text-white capitalize">{tpl.replace('-', ' ')}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {tpl === 'hero-centered' ? 'Centered layout, full-width headline' : 'Split layout with image on the right'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

          {/* Headline */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass.replace('mb-1', '')}>Headline *</label>
              <span className="text-xs text-zinc-600">{(config.headline ?? '').length}/100</span>
            </div>
            <input
              type="text"
              value={config.headline ?? ''}
              onChange={(e) => updateConfig({ headline: e.target.value })}
              maxLength={100}
              placeholder="Your compelling headline"
              required
              className={inputClass}
            />
          </div>

          {/* Subheadline */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass.replace('mb-1', '')}>Subheadline *</label>
              <span className="text-xs text-zinc-600">{(config.subheadline ?? '').length}/160</span>
            </div>
            <input
              type="text"
              value={config.subheadline ?? ''}
              onChange={(e) => updateConfig({ subheadline: e.target.value })}
              maxLength={160}
              placeholder="Supporting message"
              required
              className={inputClass}
            />
          </div>

          {/* Body Copy */}
          <div>
            <label className={labelClass}>Body Copy</label>
            <textarea
              value={config.body_copy ?? ''}
              onChange={(e) => updateConfig({ body_copy: e.target.value })}
              rows={3}
              placeholder="Describe your value proposition in detail…"
              className={inputClass + ' resize-none'}
            />
          </div>

          {/* CTA Primary */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>CTA Primary Text *</label>
              <input
                type="text"
                value={config.cta_primary?.text ?? ''}
                onChange={(e) => updateConfig({ cta_primary: { ...config.cta_primary, text: e.target.value, action: config.cta_primary?.action ?? '#' } })}
                placeholder="Get Started Free"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>CTA Primary URL *</label>
              <input
                type="text"
                value={config.cta_primary?.action ?? ''}
                onChange={(e) => updateConfig({ cta_primary: { text: config.cta_primary?.text ?? '', action: e.target.value } })}
                placeholder="https://app.example.com/signup"
                required
                className={inputClass}
              />
            </div>
          </div>

          {/* Secondary CTA (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowSecondary((v) => !v)}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>{showSecondary ? '▼' : '▶'}</span>
              Secondary CTA (optional)
            </button>
            {showSecondary && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className={labelClass}>Secondary CTA Text</label>
                  <input
                    type="text"
                    value={config.cta_secondary?.text ?? ''}
                    onChange={(e) => updateConfig({ cta_secondary: { text: e.target.value, action: config.cta_secondary?.action ?? '#' } })}
                    placeholder="Learn More"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Secondary CTA URL</label>
                  <input
                    type="text"
                    value={config.cta_secondary?.action ?? ''}
                    onChange={(e) => updateConfig({ cta_secondary: { text: config.cta_secondary?.text ?? '', action: e.target.value } })}
                    placeholder="#features"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Hero Image */}
          <div>
            <label className={labelClass}>Hero Image URL (optional)</label>
            <input
              type="text"
              value={config.hero_image ?? ''}
              onChange={(e) => updateConfig({ hero_image: e.target.value || undefined })}
              placeholder="https://example.com/image.jpg"
              className={inputClass}
            />
          </div>

          {/* Social Proof */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass.replace('mb-1', '')}>Social Proof Items</label>
              <button type="button" onClick={addSocialProof} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">+ Add</button>
            </div>
            <div className="space-y-2">
              {socialProofItems.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => updateSocialProof(idx, e.target.value)}
                    placeholder={`"Testimonial or proof point #${idx + 1}"`}
                    className={inputClass}
                  />
                  <button type="button" onClick={() => removeSocialProof(idx)} className="text-zinc-500 hover:text-red-400 transition-colors text-sm px-1">&times;</button>
                </div>
              ))}
              {socialProofItems.length === 0 && <p className="text-xs text-zinc-600">No social proof items yet</p>}
            </div>
          </div>

          {/* SEO Section (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowSeo((v) => !v)}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>{showSeo ? '▼' : '▶'}</span>
              SEO / Meta Tags
            </button>
            {showSeo && (
              <div className="space-y-3 mt-2">
                <div>
                  <label className={labelClass}>Meta Title</label>
                  <input
                    type="text"
                    value={config.meta_title ?? ''}
                    onChange={(e) => updateConfig({ meta_title: e.target.value })}
                    placeholder="Page title for search engines"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Meta Description</label>
                  <textarea
                    value={config.meta_description ?? ''}
                    onChange={(e) => updateConfig({ meta_description: e.target.value })}
                    rows={2}
                    placeholder="Brief description for search results"
                    className={inputClass + ' resize-none'}
                  />
                </div>
                <div>
                  <label className={labelClass}>OG Image URL</label>
                  <input
                    type="text"
                    value={config.og_image ?? ''}
                    onChange={(e) => updateConfig({ og_image: e.target.value || undefined })}
                    placeholder="https://example.com/og-image.jpg"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

            </>
          )}

          {/* Traffic Weight (weighted strategy only) */}
          {trafficSplitStrategy === 'weighted' && (
            <div>
              <label className={labelClass}>Traffic Weight — <span className="text-amber-400">{trafficWeight}%</span></label>
              <input
                type="number"
                min={0}
                max={100}
                value={trafficWeight}
                onChange={(e) => setTrafficWeight(Number(e.target.value))}
                className={inputClass}
              />
            </div>
          )}

          {/* Change description (for edits) */}
          {variant && (
            <div>
              <label className={labelClass}>Change Description (optional)</label>
              <input
                type="text"
                value={changeDescription}
                onChange={(e) => setChangeDescription(e.target.value)}
                placeholder="What did you change and why?"
                className={inputClass}
              />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel} className="border border-white/20 hover:border-white/40 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Saving…' : variant ? 'Save Changes' : 'Create Variant'}
            </button>
          </div>
        </div>

        {/* Right — preview panel */}
        {variantType === 'template' ? (
          <div className="flex-[2] min-w-0">
            <p className="text-xs text-zinc-500 mb-2">Live Preview</p>
            <VariantPreview config={config} />
            <p className="text-xs text-zinc-600 mt-2 text-center">Preview at 33% scale</p>
          </div>
        ) : variantType === 'fork' ? (
          <div className="flex-[2] min-w-0 flex items-center justify-center">
            <div className="text-center p-8 border border-white/5 rounded-xl bg-zinc-900/50 w-full">
              {forkResult ? (
                <>
                  <p className="text-green-400 text-lg mb-2">{'\u2713'}</p>
                  <p className="text-sm text-green-400 font-medium">PR #{forkResult.pr_number} Created</p>
                  <p className="text-xs text-zinc-500 mt-1">Route: {forkResult.new_route}</p>
                  <a
                    href={forkResult.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block"
                  >
                    View PR {'\u2197'}
                  </a>
                </>
              ) : (
                <>
                  <p className="text-lg mb-2">{'\u2442'}</p>
                  <p className="text-sm text-zinc-400 font-medium">Fork Variant</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Will duplicate <span className="font-mono text-zinc-500">{sourceFile}</span>
                  </p>
                  {forkRoute && (
                    <p className="text-xs text-zinc-500 mt-1">
                      New route: <span className="font-mono text-amber-400">/{forkRoute}</span>
                    </p>
                  )}
                  <p className="text-xs text-zinc-700 mt-3">Creates a PR on GitHub for review</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-[2] min-w-0 flex items-center justify-center">
            <div className="text-center p-8 border border-white/5 rounded-xl bg-zinc-900/50">
              <p className="text-2xl mb-2">{'\u2197'}</p>
              <p className="text-sm text-zinc-400 font-medium">External URL</p>
              {externalUrl && (
                <p className="text-xs text-zinc-600 mt-1 break-all">{externalUrl}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
