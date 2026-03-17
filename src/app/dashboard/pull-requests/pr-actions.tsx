'use client';

import { useState } from 'react';

export function MergeButton({ changeId }: { changeId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleMerge() {
    if (!confirm('Merge this PR and activate experiment tracking?')) return;
    setStatus('loading');
    try {
      const res = await fetch(`/api/pull-requests/${changeId}/merge`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(`Merge failed: ${err.error ?? 'Unknown error'}`);
        setStatus('error');
        return;
      }
      setStatus('done');
      window.location.reload();
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      onClick={handleMerge}
      disabled={status === 'loading' || status === 'done'}
      className="text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
    >
      {status === 'loading' ? 'Merging...' : 'Merge ↓'}
    </button>
  );
}

export function CloseButton({ changeId }: { changeId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleClose() {
    if (!confirm('Close this PR without merging?')) return;
    setStatus('loading');
    try {
      const res = await fetch(`/api/pull-requests/${changeId}/close`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(`Close failed: ${err.error ?? 'Unknown error'}`);
        setStatus('error');
        return;
      }
      setStatus('done');
      window.location.reload();
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      onClick={handleClose}
      disabled={status === 'loading' || status === 'done'}
      className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
    >
      {status === 'loading' ? 'Closing...' : 'Close'}
    </button>
  );
}
