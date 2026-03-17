'use client';

import { useState } from 'react';

interface Change {
  id: string;
  hypothesis: string;
  description: string;
  change_type: string;
  verdict: string;
  confidence_level: number | null;
  samples_collected: number;
  min_sample_size: number;
  implemented_at: Date;
  evaluated_at: Date | null;
  diff_summary: string | null;
  variant_id: string;
}

interface AgentLogClientProps {
  changes: Change[];
}

const VERDICT_TABS = ['All', 'Proposed', 'Pending', 'Win', 'Loss', 'Neutral', 'Rejected'] as const;
type VerdictTab = typeof VERDICT_TABS[number];

const verdictColors: Record<string, string> = {
  win: 'bg-green-500/20 text-green-400',
  loss: 'bg-red-500/20 text-red-400',
  pending: 'bg-amber-500/20 text-amber-400',
  need_more_data: 'bg-amber-500/20 text-amber-400',
  neutral: 'bg-zinc-500/20 text-zinc-400',
  proposed: 'bg-blue-500/20 text-blue-400',
  rejected: 'bg-red-900/20 text-red-500',
};

const changeTypeBadge: Record<string, string> = {
  copy: 'bg-zinc-800 text-zinc-300',
  layout: 'bg-zinc-800 text-zinc-300',
  style: 'bg-zinc-800 text-zinc-300',
  cta: 'bg-zinc-800 text-amber-300',
  image: 'bg-zinc-800 text-blue-300',
  template: 'bg-zinc-800 text-purple-300',
};

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function filterByTab(changes: Change[], tab: VerdictTab): Change[] {
  if (tab === 'All') return changes;
  const verdictMap: Record<VerdictTab, string[]> = {
    All: [],
    Proposed: ['proposed'],
    Pending: ['pending', 'need_more_data'],
    Win: ['win'],
    Loss: ['loss'],
    Neutral: ['neutral'],
    Rejected: ['rejected'],
  };
  const allowed = verdictMap[tab];
  return changes.filter((c) => allowed.includes(c.verdict));
}

function ChangeCard({ change }: { change: Change }) {
  const [expanded, setExpanded] = useState(false);

  const isPending = change.verdict === 'pending' || change.verdict === 'need_more_data';
  const progress = isPending && change.min_sample_size > 0
    ? Math.min(100, Math.round((change.samples_collected / change.min_sample_size) * 100))
    : null;

  let diffData: Record<string, unknown> | null = null;
  if (change.diff_summary) {
    try { diffData = JSON.parse(change.diff_summary) as Record<string, unknown>; } catch { /* raw text */ }
  }

  return (
    <div className="border border-white/10 rounded-xl bg-zinc-900 overflow-hidden">
      <div
        className="px-5 py-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs text-zinc-500">{timeAgo(change.implemented_at)}</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${changeTypeBadge[change.change_type] ?? 'bg-zinc-800 text-zinc-300'}`}>
                {change.change_type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${verdictColors[change.verdict] ?? ''}`}>
                {change.verdict === 'need_more_data' ? 'need more data' : change.verdict}
              </span>
              {change.confidence_level !== null && change.confidence_level > 0 && (
                <span className="text-xs text-zinc-500">
                  {Math.round(change.confidence_level * 100)}% confidence
                </span>
              )}
            </div>

            <p className="text-sm font-medium text-white">{change.hypothesis}</p>

            {isPending && progress !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500">Sample progress</span>
                  <span className="text-xs text-zinc-400">
                    {change.samples_collected.toLocaleString()} / {change.min_sample_size.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-600 mt-1">{progress}% of minimum sample size</p>
              </div>
            )}
          </div>
          <span className="text-zinc-600 text-xs mt-1 flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 border-t border-white/5 pt-4 space-y-3">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Description</p>
            <p className="text-sm text-zinc-300">{change.description}</p>
          </div>

          {change.evaluated_at && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Evaluated</p>
              <p className="text-xs text-zinc-400">{new Date(change.evaluated_at).toLocaleString()}</p>
            </div>
          )}

          {diffData && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Diff Summary</p>
              <pre className="text-xs text-zinc-400 bg-zinc-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify(diffData, null, 2)}
              </pre>
            </div>
          )}

          {change.diff_summary && !diffData && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Diff Summary</p>
              <p className="text-xs text-zinc-400 bg-zinc-800 rounded-lg p-3">{change.diff_summary}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-zinc-600 font-mono">variant: {change.variant_id.slice(0, 8)}…</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentLogClient({ changes }: AgentLogClientProps) {
  const [activeTab, setActiveTab] = useState<VerdictTab>('All');

  const filtered = filterByTab(changes, activeTab);

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0 overflow-x-auto">
        {VERDICT_TABS.map((tab) => {
          const count = filterByTab(changes, tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? 'border-amber-500 text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
              {tab !== 'All' && count > 0 && (
                <span className="ml-1.5 text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Change cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <p>No changes match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((change) => (
            <ChangeCard key={change.id} change={change} />
          ))}
        </div>
      )}
    </div>
  );
}
