'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ArchiveProjectButton({ projectId }: { projectId: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleArchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    if (!confirm('Archive this project? It will be hidden from the dashboard.')) return;
    setLoading(true);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    if (!confirm('Permanently delete this project and all its verticals, variants, and data? This cannot be undone.')) return;
    setLoading(true);
    try {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative z-10" onClick={(e) => e.preventDefault()}>
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        disabled={loading}
        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-50"
      >
        {loading ? '…' : '⋯'}
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
          <div className="absolute right-0 bottom-full mb-1 z-20 bg-zinc-900 border border-white/10 rounded-xl shadow-xl w-36 overflow-hidden">
            <button
              onClick={handleArchive}
              className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 transition-colors"
            >
              Archive
            </button>
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-white/5"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
