'use client';

import { useState } from 'react';

interface Assignment {
  id: string;
  ad_creative_id: string;
  creative_name: string;
  creative_platform: string;
  creative_format: string;
  vertical_name: string;
  vertical_slug: string;
  variant_slug: string | null;
  status: string;
  utm_content_tag: string;
  daily_budget: number | null;
}

interface Props {
  assignments: Assignment[];
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  ended: 'bg-zinc-500',
};

const STATUS_TEXT: Record<string, string> = {
  active: 'text-green-400',
  paused: 'text-yellow-400',
  ended: 'text-zinc-500',
};

const PLATFORM_BADGE: Record<string, string> = {
  meta: 'bg-blue-500/20 text-blue-400 border border-blue-500/20',
  google: 'bg-red-500/20 text-red-400 border border-red-500/20',
  linkedin: 'bg-blue-700/20 text-blue-300 border border-blue-700/20',
};

function fmt$(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k/d`;
  return `$${n.toFixed(0)}/d`;
}

export function AssignmentsList({ assignments: initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggleStatus(assignment: Assignment) {
    if (togglingId) return;
    const newStatus = assignment.status === 'active' ? 'paused' : 'active';
    setTogglingId(assignment.id);

    try {
      const res = await fetch(`/api/ad-assignments/${assignment.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignment.id ? { ...a, status: newStatus } : a))
        );
      }
    } catch {
      // silently fail
    } finally {
      setTogglingId(null);
    }
  }

  async function handleCopyUtm(assignment: Assignment) {
    try {
      await navigator.clipboard.writeText(assignment.utm_content_tag);
      setCopiedId(assignment.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // silently fail
    }
  }

  if (assignments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
          <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        <p className="text-zinc-400 font-medium text-sm">No assignments yet</p>
        <p className="text-zinc-600 text-xs mt-1">Assign an ad creative to a vertical to start tracking.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Ad Creative</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Platform</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Vertical</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Variant</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Status</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">UTM Tag</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3 pr-4">Budget</th>
            <th className="text-left text-xs text-zinc-500 font-medium pb-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {assignments.map((a) => (
            <tr key={a.id} className="group">
              <td className="py-3 pr-4">
                <p className="text-white font-medium truncate max-w-[160px]">{a.creative_name}</p>
                <p className="text-zinc-500 text-xs">{a.creative_format}</p>
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_BADGE[a.creative_platform] ?? 'bg-zinc-700 text-zinc-300 border border-zinc-600'}`}
                >
                  {a.creative_platform}
                </span>
              </td>
              <td className="py-3 pr-4">
                <p className="text-white">{a.vertical_name}</p>
                <p className="text-zinc-600 text-xs">{a.vertical_slug}</p>
              </td>
              <td className="py-3 pr-4">
                {a.variant_slug ? (
                  <span className="text-zinc-300 text-xs bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">
                    {a.variant_slug}
                  </span>
                ) : (
                  <span className="text-zinc-500 text-xs">All</span>
                )}
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status] ?? 'bg-zinc-500'}`} />
                  <span className={`text-xs capitalize ${STATUS_TEXT[a.status] ?? 'text-zinc-500'}`}>
                    {a.status}
                  </span>
                </div>
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-1.5 max-w-[200px]">
                  <code className="text-xs text-zinc-400 font-mono truncate">{a.utm_content_tag}</code>
                  <button
                    onClick={() => handleCopyUtm(a)}
                    title="Copy UTM tag"
                    className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {copiedId === a.id ? (
                      <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </td>
              <td className="py-3 pr-4">
                <span className="text-zinc-300 text-xs">{fmt$(a.daily_budget)}</span>
              </td>
              <td className="py-3">
                {a.status !== 'ended' && (
                  <button
                    onClick={() => handleToggleStatus(a)}
                    disabled={togglingId === a.id}
                    title={a.status === 'active' ? 'Pause' : 'Resume'}
                    className="text-xs border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {togglingId === a.id
                      ? '…'
                      : a.status === 'active'
                      ? 'Pause'
                      : 'Resume'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
