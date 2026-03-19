'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { VariantModal } from '@/components/dashboard/modals/variant-modal';

interface SignificanceData {
  relativeLift: number;
  isSignificant: boolean;
  confidence: number;
  winner: 'variant' | 'control' | 'none';
}

interface VariantMetricsData {
  visitors: number;
  clicks: number;
  convRate: number;
  significance: SignificanceData;
  sampleStatus: { enough: boolean; percentComplete: number };
}

interface VariantRow {
  id: string;
  slug: string;
  version: number;
  status: string;
  config: unknown;
  traffic_weight: number;
  variant_type?: string;
  external_url?: string | null;
  source_file?: string | null;
  is_control?: boolean;
}

interface VerticalSectionProps {
  projectId: string;
  vertical: {
    id: string;
    name: string;
    slug: string;
    status: string;
    traffic_split_strategy: string;
  };
  variants: VariantRow[];
  metricsMap: Record<string, VariantMetricsData>;
  controlSlug: string;
  funnelFocus: string;
}

const SPLIT_STRATEGIES = [
  { value: 'equal', label: 'Equal Split', desc: 'Traffic split evenly across active variants' },
  { value: 'weighted', label: 'Weighted', desc: 'You control each variant\'s traffic allocation' },
  { value: 'champion_challenger', label: 'Champion / Challenger', desc: 'Champion gets 80%, challengers split 20%' },
];

const variantStatusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  winner: 'bg-amber-500/20 text-amber-400',
  killed: 'bg-red-500/20 text-red-400',
};

// Metric labels keyed by funnel_focus
const FUNNEL_LABELS: Record<string, { visitors: string; convRate: string }> = {
  acquisition: { visitors: 'visitors', convRate: 'CVR' },
  activation: { visitors: 'sessions', convRate: 'activation' },
  monetization: { visitors: 'users', convRate: 'purchase rate' },
  retention: { visitors: 'users', convRate: 'return rate' },
  referral: { visitors: 'users', convRate: 'referral rate' },
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function VerticalSection({
  projectId,
  vertical,
  variants,
  metricsMap,
  controlSlug,
  funnelFocus,
}: VerticalSectionProps) {
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<VariantRow | undefined>();
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [variantMenuOpen, setVariantMenuOpen] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [dailyData, setDailyData] = useState<Array<{ date: string; visitors: number }> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [currentStrategy, setCurrentStrategy] = useState(vertical.traffic_split_strategy);
  const [verticalName, setVerticalName] = useState(vertical.name);
  const [verticalStatus, setVerticalStatus] = useState(vertical.status);
  const [deleted, setDeleted] = useState(false);
  const [variantStatuses, setVariantStatuses] = useState<Record<string, string>>(
    Object.fromEntries(variants.map((v) => [v.id, v.status]))
  );
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  const labels = FUNNEL_LABELS[funnelFocus] ?? FUNNEL_LABELS.acquisition;

  // Derive control variant info from variants prop
  const controlVariant = variants.find((v) => v.is_control) ?? variants[0];
  const controlSourceUrl = controlVariant?.external_url ?? null;
  const controlSourceFile = controlVariant?.source_file ?? null;

  // Vertical-level totals across non-killed variants
  const liveVariants = variants.filter((v) => (variantStatuses[v.id] ?? v.status) !== 'killed');
  const totalVisitors = liveVariants.reduce((sum, v) => sum + (metricsMap[v.id]?.visitors ?? 0), 0);
  const totalClicks = liveVariants.reduce((sum, v) => sum + (metricsMap[v.id]?.clicks ?? 0), 0);
  const overallConvRate = totalVisitors > 0 ? totalClicks / totalVisitors : 0;

  function openNew() {
    setEditingVariant(undefined);
    setVariantModalOpen(true);
  }

  function openEdit(v: VariantRow) {
    setEditingVariant(v);
    setVariantModalOpen(true);
    setVariantMenuOpen(null);
  }

  function handleSaved() {
    setVariantModalOpen(false);
    router.refresh();
  }

  async function updateStrategy(strategy: string) {
    setLoading('strategy');
    setStrategyOpen(false);
    try {
      const res = await fetch(`/api/verticals/${vertical.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traffic_split_strategy: strategy }),
      });
      if (res.ok) {
        setCurrentStrategy(strategy);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  async function archiveVertical() {
    setMenuOpen(false);
    if (!confirm(`Archive "${verticalName}"? It will stop receiving traffic.`)) return;
    setLoading('archive');
    try {
      const res = await fetch(`/api/verticals/${vertical.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (res.ok) {
        setVerticalStatus('archived');
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  async function saveRename() {
    if (!renamingName || renamingName.trim() === verticalName) {
      setRenamingName(null);
      return;
    }
    setLoading('rename');
    try {
      const res = await fetch(`/api/verticals/${vertical.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renamingName.trim() }),
      });
      if (res.ok) {
        setVerticalName(renamingName.trim());
        router.refresh();
      }
    } finally {
      setLoading(null);
      setRenamingName(null);
    }
  }

  async function deleteVertical() {
    setMenuOpen(false);
    if (!confirm(`Permanently delete "${verticalName}" and all its variants? This cannot be undone.`)) return;
    setLoading('delete');
    try {
      const res = await fetch(`/api/verticals/${vertical.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleted(true);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  async function setVariantStatus(variantId: string, status: string) {
    if (status === 'killed' && !confirm('Kill this variant? It will stop receiving traffic.')) return;
    if (status === 'winner' && !confirm('Mark as winner? This will pause all other active variants.')) return;

    setVariantMenuOpen(null);
    setLoading(variantId);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'winner') body.pause_others = true;

      const res = await fetch(`/api/variants/${variantId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (status === 'winner') {
          setVariantStatuses((prev) => {
            const next = { ...prev, [variantId]: status };
            for (const id of Object.keys(next)) {
              if (id !== variantId && next[id] === 'active') next[id] = 'paused';
            }
            return next;
          });
        } else {
          setVariantStatuses((prev) => ({ ...prev, [variantId]: status }));
        }
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  const isArchived = verticalStatus === 'archived';

  if (deleted) return null;

  return (
    <div className={`border rounded-xl ${isArchived ? 'border-white/5 opacity-50' : 'border-white/10 bg-zinc-900'}`}>
      {/* Vertical header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
        <div className="flex-1 min-w-0 mr-4">
          {renamingName !== null ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={renamingName}
                onChange={(e) => setRenamingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                  if (e.key === 'Escape') setRenamingName(null);
                }}
                className="bg-zinc-800 border border-white/20 rounded-md px-2 py-1 text-sm font-semibold text-white focus:outline-none focus:border-white/40 w-48"
              />
              <button onClick={saveRename} disabled={loading === 'rename'} className="text-xs text-green-400 hover:text-green-300 transition-colors">Save</button>
              <button onClick={() => setRenamingName(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          ) : (
            <>
              <h2 className="font-semibold">{verticalName}</h2>
              <p className="text-zinc-500 text-xs mt-0.5">/{vertical.slug}</p>
              {controlSourceUrl && (
                <a
                  href={controlSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors mt-0.5 truncate max-w-xs block"
                >
                  {controlSourceUrl} {'\u2197'}
                </a>
              )}
              {controlSourceFile && !controlSourceUrl && (
                <p className="text-xs text-zinc-600 font-mono mt-0.5">{controlSourceFile}</p>
              )}
            </>
          )}
        </div>

        {/* Total traffic stats */}
        <div className="flex items-center gap-3 text-xs mr-4 flex-shrink-0">
          <span className="text-zinc-300 font-medium tabular-nums">
            {formatNum(totalVisitors)}
            <span className="text-zinc-600 font-normal ml-1">{labels.visitors}</span>
          </span>
          <span className="text-zinc-700">{'\u00B7'}</span>
          <span className="text-zinc-300 font-medium tabular-nums">
            {formatPct(overallConvRate)}
            <span className="text-zinc-600 font-normal ml-1">{labels.convRate}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Editable strategy badge */}
          <div className="relative">
            <button
              onClick={() => setStrategyOpen((o) => !o)}
              disabled={isArchived || loading === 'strategy'}
              className="text-xs px-2 py-0.5 rounded-full font-medium bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/70 hover:text-zinc-200 transition-colors flex items-center gap-1"
            >
              {loading === 'strategy' ? '...' : currentStrategy}
              <span className="text-zinc-600">▾</span>
            </button>
            {strategyOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 bg-zinc-900 border border-white/10 rounded-xl shadow-xl w-64 overflow-hidden">
                {SPLIT_STRATEGIES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateStrategy(s.value)}
                    className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${currentStrategy === s.value ? 'text-amber-400' : 'text-zinc-200'}`}
                  >
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{s.desc}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            verticalStatus === 'active' ? 'bg-green-500/20 text-green-400'
            : verticalStatus === 'archived' ? 'bg-zinc-500/20 text-zinc-500'
            : 'bg-zinc-500/20 text-zinc-400'
          }`}>
            {verticalStatus}
          </span>

          {/* ⋯ vertical actions menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              disabled={loading === 'delete'}
              className="text-xs text-zinc-500 hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-white/5"
            >
              {loading === 'delete' ? '...' : '⋯'}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 bg-zinc-900 border border-white/10 rounded-xl shadow-xl w-40 overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); setRenamingName(verticalName); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors"
                >
                  Rename
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowStats((v) => !v);
                    if (!dailyData && !loadingStats) {
                      setLoadingStats(true);
                      fetch(`/api/analytics/vertical/${vertical.id}/daily`)
                        .then((r) => r.json())
                        .then((d: { daily?: Array<{ date: string; visitors: number }> }) => {
                          setDailyData(d.daily ?? []);
                        })
                        .catch(() => setDailyData([]))
                        .finally(() => setLoadingStats(false));
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors border-t border-white/5"
                >
                  {showStats ? 'Hide Stats' : 'Performance Stats'}
                </button>
                {!isArchived && (
                  <button
                    onClick={archiveVertical}
                    className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors border-t border-white/5"
                  >
                    Archive
                  </button>
                )}
                <button
                  onClick={deleteVertical}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-white/5"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Performance stats panel */}
      {showStats && (
        <div className="px-5 py-4 border-b border-white/5 bg-zinc-800/20">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-400 font-medium">Daily Visitors (30d)</p>
            <button onClick={() => setShowStats(false)} className="text-xs text-zinc-600 hover:text-zinc-400">{'\u2715'}</button>
          </div>
          {loadingStats && <p className="text-xs text-zinc-600 animate-pulse">Loading...</p>}
          {dailyData && dailyData.length > 0 && (
            <div className="flex items-end gap-px h-20">
              {(() => {
                const max = Math.max(...dailyData.map((d) => d.visitors), 1);
                return dailyData.map((d, i) => (
                  <div key={i} className="flex-1 group relative">
                    <div
                      className="bg-amber-500/40 hover:bg-amber-500/70 rounded-t-sm transition-colors w-full"
                      style={{ height: `${Math.max((d.visitors / max) * 100, 2)}%` }}
                    />
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-800 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 whitespace-nowrap z-10">
                      {d.date}: {d.visitors}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
          {dailyData && dailyData.length === 0 && (
            <p className="text-xs text-zinc-600">No data yet</p>
          )}
          <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-600">
            <span>{dailyData?.[0]?.date ?? ''}</span>
            <span>{dailyData?.[dailyData.length - 1]?.date ?? ''}</span>
          </div>
        </div>
      )}

      {/* Variant rows */}
      {variants.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-zinc-600 text-sm mb-3">No variants yet</p>
          <button
            onClick={openNew}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors"
          >
            Add First Variant
          </button>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {variants.map((variant) => {
            const status = variantStatuses[variant.id] ?? variant.status;
            const isKilled = status === 'killed';
            const isControl = variant.slug === controlSlug;
            const metrics = metricsMap[variant.id];

            return (
              <div
                key={variant.id}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${isKilled ? 'opacity-40' : 'hover:bg-white/5'}`}
              >
                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{variant.slug}</span>
                    <span className="text-zinc-600 text-xs">v{variant.version}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${variantStatusColors[status] ?? ''}`}>
                      {status}
                    </span>
                    <span className="text-zinc-700 text-xs">{variant.traffic_weight}%</span>
                    {isControl && (
                      <span className="text-xs text-zinc-600 font-mono">control</span>
                    )}
                    {variant.external_url && (() => {
                      const url = variant.external_url!;
                      let displayUrl: string;
                      let fullUrl: string;
                      try {
                        const u = new URL(url);
                        displayUrl = u.hostname + u.pathname.replace(/\/$/, '');
                        fullUrl = url;
                      } catch {
                        if (url.startsWith('/') && controlSourceUrl) {
                          try {
                            const base = new URL(controlSourceUrl);
                            displayUrl = base.hostname + url;
                            fullUrl = base.origin + url;
                          } catch {
                            displayUrl = url;
                            fullUrl = url;
                          }
                        } else {
                          displayUrl = url;
                          fullUrl = url;
                        }
                      }
                      return (
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400/70 hover:text-blue-400 flex items-center gap-1 truncate max-w-64 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {'\u2197'} {displayUrl}
                        </a>
                      );
                    })()}
                  </div>
                </div>

                {/* Success metrics */}
                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                  {metrics ? (
                    <>
                      <span className="text-zinc-300 font-medium tabular-nums">
                        {formatNum(metrics.visitors)}
                        <span className="text-zinc-600 font-normal ml-1">{labels.visitors}</span>
                      </span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-zinc-300 font-medium tabular-nums">
                        {formatPct(metrics.convRate)}
                        <span className="text-zinc-600 font-normal ml-1">{labels.convRate}</span>
                      </span>
                      {!isControl && (
                        <>
                          <span className="text-zinc-700">·</span>
                          {metrics.sampleStatus.enough ? (
                            <span className={`font-semibold tabular-nums ${metrics.significance.relativeLift >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {metrics.significance.relativeLift >= 0 ? '+' : ''}
                              {(metrics.significance.relativeLift * 100).toFixed(1)}%
                              {metrics.significance.isSignificant && (
                                <span className="text-[10px] ml-0.5 opacity-70">✓</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-zinc-700">collecting data</span>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-zinc-700">— no data</span>
                  )}
                </div>

                {/* Delete button for killed variants */}
                {isKilled && (
                  <button
                    onClick={async () => {
                      if (!confirm('Remove this variant permanently?')) return;
                      setLoading(variant.id);
                      try {
                        const res = await fetch(`/api/variants/${variant.id}`, { method: 'DELETE' });
                        if (res.ok) router.refresh();
                      } finally {
                        setLoading(null);
                      }
                    }}
                    disabled={loading === variant.id}
                    className="text-xs text-red-400/70 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-2 py-1 rounded-md transition-colors flex-shrink-0"
                  >
                    {loading === variant.id ? '...' : 'Delete'}
                  </button>
                )}

                {/* ⋯ per-variant menu */}
                {!isKilled && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setVariantMenuOpen((prev) => prev === variant.id ? null : variant.id)}
                      disabled={loading === variant.id}
                      className="text-zinc-600 hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-white/5 text-xs"
                    >
                      {loading === variant.id ? '...' : '⋯'}
                    </button>
                    {variantMenuOpen === variant.id && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-white/10 rounded-xl shadow-xl w-40 overflow-hidden">
                        <button
                          onClick={() => openEdit(variant)}
                          className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors"
                        >
                          Edit
                        </button>
                        {variant.variant_type === 'external_url' && variant.external_url ? (
                          <a
                            href={variant.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setVariantMenuOpen(null)}
                            className="block w-full text-left px-4 py-2.5 text-sm text-blue-400 hover:bg-white/5 transition-colors border-t border-white/5"
                          >
                            Open URL &#8599;
                          </a>
                        ) : (
                          <Link
                            href={`/lp/${vertical.slug}/${variant.slug}`}
                            target="_blank"
                            onClick={() => setVariantMenuOpen(null)}
                            className="block w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors border-t border-white/5"
                          >
                            View &#8599;
                          </Link>
                        )}
                        <Link
                          href={`/dashboard/projects/${projectId}/verticals/${vertical.id}/variants/${variant.id}`}
                          onClick={() => setVariantMenuOpen(null)}
                          className="block w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 transition-colors border-t border-white/5"
                        >
                          Stats
                        </Link>
                        <div className="border-t border-white/5">
                          {status === 'active' && (
                            <>
                              <button
                                onClick={() => setVariantStatus(variant.id, 'winner')}
                                className="w-full text-left px-4 py-2.5 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors"
                              >
                                Mark winner ★
                              </button>
                              <button
                                onClick={() => setVariantStatus(variant.id, 'paused')}
                                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 transition-colors border-t border-white/5"
                              >
                                Pause
                              </button>
                            </>
                          )}
                          {status === 'paused' && (
                            <button
                              onClick={() => setVariantStatus(variant.id, 'active')}
                              className="w-full text-left px-4 py-2.5 text-sm text-green-400 hover:bg-green-500/10 transition-colors"
                            >
                              Resume
                            </button>
                          )}
                          {status === 'winner' && (
                            <p className="px-4 py-2.5 text-sm text-amber-400/60">Champion ★</p>
                          )}
                          {(status === 'active' || status === 'paused') && (
                            <button
                              onClick={() => setVariantStatus(variant.id, 'killed')}
                              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-white/5"
                            >
                              Kill
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer with totals */}
      <div className="px-5 py-3 bg-zinc-800/30 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{liveVariants.length} active variant{liveVariants.length !== 1 ? 's' : ''}</span>
          {totalVisitors > 0 && (
            <>
              <span>·</span>
              <span className="text-zinc-400">
                {formatNum(totalVisitors)} {labels.visitors}
              </span>
              <span>·</span>
              <span className="text-zinc-400">
                {formatPct(overallConvRate)} {labels.convRate}
              </span>
            </>
          )}
        </div>
        {!isArchived && (
          <button
            onClick={openNew}
            className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            + Add Variant
          </button>
        )}
      </div>

      {/* Click outside to close dropdowns */}
      {(strategyOpen || menuOpen || variantMenuOpen !== null) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setStrategyOpen(false);
            setMenuOpen(false);
            setVariantMenuOpen(null);
          }}
        />
      )}

      <VariantModal
        open={variantModalOpen}
        onClose={() => setVariantModalOpen(false)}
        verticalId={vertical.id}
        projectId={projectId}
        trafficSplitStrategy={currentStrategy}
        sourceFile={controlSourceFile}
        sourceUrl={controlSourceUrl}
        variant={editingVariant}
        onSaved={handleSaved}
      />
    </div>
  );
}
