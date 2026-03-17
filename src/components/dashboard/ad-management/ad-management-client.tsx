'use client';

import { useState } from 'react';
import { CreativeFormModal } from './creative-form-modal';
import { AssignmentFormModal } from './assignment-form-modal';
import { AssignmentsList } from './assignments-list';

// ---- Types ----------------------------------------------------------------

interface Creative {
  id: string;
  project_id: string;
  name: string;
  platform: string;
  format: string;
  version: number;
  status: string;
  copy_headline: string | null;
  copy_body: string | null;
  copy_cta: string | null;
  assignment_count: number;
  total_spend: number;
  total_conversions: number;
}

interface VariantBasic {
  id: string;
  slug: string;
}

interface VerticalBasic {
  id: string;
  name: string;
  slug: string;
  variants: VariantBasic[];
}

interface AssignmentRow {
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

interface Project {
  id: string;
  name: string;
}

interface Props {
  creatives: Creative[];
  assignments: AssignmentRow[];
  verticals: VerticalBasic[];
  projects: Project[];
  defaultProjectId: string;
}

// ---- Helpers ---------------------------------------------------------------

const PLATFORM_BADGE: Record<string, string> = {
  meta: 'bg-blue-500/20 text-blue-400 border border-blue-500/20',
  google: 'bg-red-500/20 text-red-400 border border-red-500/20',
  linkedin: 'bg-blue-700/20 text-blue-300 border border-blue-700/20',
};

const FORMAT_BADGE = 'bg-zinc-800 text-zinc-400 border border-white/10';

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  archived: 'bg-zinc-600',
};

const STATUS_TEXT: Record<string, string> = {
  active: 'text-green-400',
  paused: 'text-yellow-400',
  archived: 'text-zinc-500',
};

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

// ---- Component -------------------------------------------------------------

export function AdManagementClient({
  creatives: initialCreatives,
  assignments: initialAssignments,
  verticals,
  defaultProjectId,
}: Props) {
  const [creatives, setCreatives] = useState<Creative[]>(initialCreatives);
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initialAssignments);

  const [creativeModalOpen, setCreativeModalOpen] = useState(false);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);

  function handleCreativeSaved(saved: { id: string; name: string }) {
    // Optimistically add a skeleton row; a full refresh would be ideal but
    // adding the returned value keeps the UI responsive without a hard reload.
    const newCreative: Creative = {
      id: saved.id,
      project_id: defaultProjectId,
      name: saved.name,
      platform: '',
      format: '',
      version: 1,
      status: 'active',
      copy_headline: null,
      copy_body: null,
      copy_cta: null,
      assignment_count: 0,
      total_spend: 0,
      total_conversions: 0,
    };
    setCreatives((prev) => [newCreative, ...prev]);
    setCreativeModalOpen(false);
  }

  function handleAssignmentSaved(result: { utm_content_tag: string; assignment: unknown }) {
    // Re-fetch or optimistically add; for now just close the modal.
    // The AssignmentFormModal shows the result screen first.
    const a = result.assignment as AssignmentRow;
    if (a && a.id) {
      setAssignments((prev) => [a, ...prev]);
    }
    setAssignmentModalOpen(false);
  }

  const formCreatives = creatives.map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    format: c.format,
    version: c.version,
  }));

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Ad Creatives                                             */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Ad Creatives</h2>
            <p className="text-zinc-500 text-xs mt-0.5">{creatives.length} creative{creatives.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setCreativeModalOpen(true)}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Ad Creative
          </button>
        </div>

        {creatives.length === 0 ? (
          <div className="border border-white/10 rounded-xl bg-zinc-900 p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-zinc-400 font-medium mb-2">No ad creatives yet</p>
            <p className="text-zinc-600 text-sm mb-6">
              Create your first ad creative to start tracking spend and assignments.
            </p>
            <button
              onClick={() => setCreativeModalOpen(true)}
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + New Ad Creative
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {creatives.map((c) => {
              const cpa =
                c.total_conversions > 0 ? c.total_spend / c.total_conversions : null;

              return (
                <div
                  key={c.id}
                  className="border border-white/10 rounded-xl bg-zinc-900 p-4 space-y-3 hover:border-white/20 transition-colors"
                >
                  {/* Badges row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.platform && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_BADGE[c.platform] ?? 'bg-zinc-700 text-zinc-300 border border-zinc-600'}`}
                      >
                        {c.platform}
                      </span>
                    )}
                    {c.format && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FORMAT_BADGE}`}>
                        {c.format}
                      </span>
                    )}
                  </div>

                  {/* Name + version */}
                  <div>
                    <p className="text-white font-medium text-sm leading-snug">{c.name}</p>
                    <p className="text-zinc-500 text-xs">v{c.version}</p>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[c.status] ?? 'bg-zinc-500'}`}
                    />
                    <span className={`text-xs capitalize ${STATUS_TEXT[c.status] ?? 'text-zinc-500'}`}>
                      {c.status}
                    </span>
                  </div>

                  {/* Headline preview */}
                  {c.copy_headline && (
                    <p className="text-zinc-400 text-xs leading-relaxed line-clamp-2 border-t border-white/5 pt-2">
                      &ldquo;{c.copy_headline}&rdquo;
                    </p>
                  )}

                  {/* Assignment count */}
                  <p className="text-zinc-500 text-xs">
                    <span className="text-zinc-300 font-medium">{c.assignment_count}</span>{' '}
                    active assignment{c.assignment_count !== 1 ? 's' : ''}
                  </p>

                  {/* Spend + CPA */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <div>
                      <p className="text-zinc-600 text-xs">Spend</p>
                      <p className="text-white text-sm font-semibold">{fmt$(c.total_spend)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-zinc-600 text-xs">CPA</p>
                      <p className="text-amber-400 text-sm font-semibold">
                        {cpa !== null ? fmt$(cpa) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: Active Assignments                                       */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Active Assignments</h2>
            <p className="text-zinc-500 text-xs mt-0.5">
              {assignments.filter((a) => a.status === 'active').length} active
              {assignments.length > 0 ? ` of ${assignments.length} total` : ''}
            </p>
          </div>
          <button
            onClick={() => setAssignmentModalOpen(true)}
            className="border border-white/20 hover:border-white/40 text-zinc-300 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Assignment
          </button>
        </div>

        <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
          <AssignmentsList assignments={assignments} />
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Modals                                                              */}
      {/* ------------------------------------------------------------------ */}
      <CreativeFormModal
        open={creativeModalOpen}
        onClose={() => setCreativeModalOpen(false)}
        projectId={defaultProjectId}
        onSaved={handleCreativeSaved}
      />

      <AssignmentFormModal
        open={assignmentModalOpen}
        onClose={() => setAssignmentModalOpen(false)}
        creatives={formCreatives}
        verticals={verticals}
        onSaved={handleAssignmentSaved}
      />
    </>
  );
}
