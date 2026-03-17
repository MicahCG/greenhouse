'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChatInterface } from './chat-interface';

interface Props {
  projectId?: string;
  initialPrompt?: string;
}

const PANEL_STATE_KEY = 'greenhouse_chat_panel_open';

export function ChatSlideOver({ projectId, initialPrompt }: Props) {
  // Persist open/closed state so reopening restores the last chat
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(PANEL_STATE_KEY) === 'true';
  });
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  // Keep ChatInterface mounted even when collapsed so state is preserved
  const [hasOpened, setHasOpened] = useState(open);
  const router = useRouter();

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(PANEL_STATE_KEY, String(next));
      return next;
    });
  }

  function openPanel() {
    setOpen(true);
    setHasOpened(true);
    localStorage.setItem(PANEL_STATE_KEY, 'true');
  }

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  // When initialPrompt changes, open the panel
  useEffect(() => {
    if (initialPrompt) {
      setPendingPrompt(initialPrompt);
      openPanel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // Listen for agent data mutations and refresh the page
  useEffect(() => {
    function handleRefresh() {
      router.refresh();
    }
    window.addEventListener('greenhouse:data-changed', handleRefresh);
    return () => window.removeEventListener('greenhouse:data-changed', handleRefresh);
  }, [router]);

  return (
    <>
      {/* Floating trigger — only shown when panel is closed */}
      {!open && (
        <button
          onClick={openPanel}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border border-amber-500/30 hover:border-amber-500/60 text-amber-400 hover:text-amber-300 font-semibold text-sm px-4 py-2.5 rounded-full shadow-lg transition-colors"
        >
          <span>{'\uD83C\uDF31'}</span> Ask Expert
        </button>
      )}

      {/* Panel — slides in from right, single click collapse/expand */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-zinc-950 border-l border-white/10 flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header with collapse button */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
          <span className="font-semibold text-sm">{'\uD83C\uDF31'} Growth Expert</span>
          <button
            onClick={toggle}
            className="text-zinc-500 hover:text-white text-sm px-2 py-1 rounded hover:bg-white/5 transition-colors"
            title="Collapse panel"
          >
            {'\u2192'}
          </button>
        </div>

        {/* Chat — stays mounted so conversation persists */}
        <div className="flex-1 min-h-0">
          {hasOpened && (
            <ChatInterface
              projectId={projectId}
              initialPrompt={pendingPrompt}
              compact
            />
          )}
        </div>
      </div>
    </>
  );
}
