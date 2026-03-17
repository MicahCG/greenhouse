'use client';

import { VariantForm } from '@/components/dashboard/variant-form';

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

interface Props {
  open: boolean;
  onClose: () => void;
  verticalId: string;
  projectId: string;
  trafficSplitStrategy?: string;
  sourceFile?: string | null;
  sourceUrl?: string | null;
  variant?: ExistingVariant;
  onSaved: () => void;
}

export function VariantModal({ open, onClose, verticalId, projectId: _projectId, trafficSplitStrategy, sourceFile, sourceUrl, variant, onSaved }: Props) {
  if (!open) return null;

  function handleSaved() {
    onSaved();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 w-full max-w-5xl my-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">{variant ? `Edit ${variant.slug}` : 'New Variant'}</h2>
            {variant && <p className="text-xs text-zinc-500 mt-0.5">v{variant.version} · {variant.status}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>

        <VariantForm
          verticalId={verticalId}
          trafficSplitStrategy={trafficSplitStrategy}
          sourceFile={sourceFile}
          sourceUrl={sourceUrl}
          variant={variant}
          onSaved={handleSaved}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
