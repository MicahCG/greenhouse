'use client';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-zinc-400">Failed to load project</p>
      <button
        onClick={reset}
        className="text-sm border border-white/20 px-4 py-2 rounded-lg hover:border-white/40"
      >
        Retry
      </button>
    </div>
  );
}
