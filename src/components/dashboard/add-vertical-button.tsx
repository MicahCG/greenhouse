'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateVerticalModal } from '@/components/dashboard/modals/create-vertical-modal';

export function AddVerticalButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleCreated() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="border border-white/20 hover:border-white/40 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors"
      >
        + Add Vertical
      </button>
      <CreateVerticalModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        onCreated={handleCreated}
      />
    </>
  );
}
