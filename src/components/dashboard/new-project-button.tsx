'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateProjectModal } from '@/components/dashboard/modals/create-project-modal';

export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleCreated(project: { id: string }) {
    setOpen(false);
    router.push(`/dashboard/projects/${project.id}`);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
      >
        + New Project
      </button>
      <CreateProjectModal open={open} onClose={() => setOpen(false)} onCreated={handleCreated} />
    </>
  );
}
