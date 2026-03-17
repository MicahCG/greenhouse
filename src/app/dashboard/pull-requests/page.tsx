export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/lib/db';
import { agent_changes, variants, verticals, projects } from '@/lib/db/schema';
import { eq, isNotNull, desc } from 'drizzle-orm';
import { getPullRequestStatus } from '@/lib/github/client';
import { resolveRepo } from '@/lib/github/permissions';
import { MergeButton, CloseButton } from './pr-actions';

interface PRRow {
  change: typeof agent_changes.$inferSelect;
  variantSlug: string;
  verticalName: string;
  projectName: string;
  prState?: string;
  prMerged?: boolean;
}

async function getOpenPRs(): Promise<PRRow[]> {
  const changes = await db
    .select()
    .from(agent_changes)
    .where(isNotNull(agent_changes.pr_url))
    .orderBy(desc(agent_changes.implemented_at))
    .limit(50);

  const rows: PRRow[] = await Promise.all(
    changes.map(async (change) => {
      const [variant] = await db
        .select({ slug: variants.slug, vertical_id: variants.vertical_id })
        .from(variants)
        .where(eq(variants.id, change.variant_id))
        .limit(1);

      const [vertical] = variant
        ? await db
            .select({ name: verticals.name, project_id: verticals.project_id })
            .from(verticals)
            .where(eq(verticals.id, variant.vertical_id))
            .limit(1)
        : [undefined];

      const [project] = vertical
        ? await db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, vertical.project_id))
            .limit(1)
        : [undefined];

      let prState: string | undefined;
      let prMerged: boolean | undefined;

      if (change.pr_number && change.github_repo) {
        try {
          const repoFull = resolveRepo(change.github_repo as 'greenhouse' | 'popcorn');
          const status = await getPullRequestStatus(repoFull, change.pr_number);
          prState = status.state;
          prMerged = status.merged;
        } catch {
          prState = 'unknown';
        }
      }

      return {
        change,
        variantSlug: variant?.slug ?? '—',
        verticalName: vertical?.name ?? '—',
        projectName: project?.name ?? '—',
        prState,
        prMerged,
      };
    })
  );

  return rows;
}

function prStateBadge(state?: string, merged?: boolean) {
  if (merged) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">Merged</span>;
  }
  if (state === 'open') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Open</span>;
  }
  if (state === 'closed') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">Closed</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700/30 text-zinc-500">Unknown</span>;
}

function verdictBadge(verdict: string) {
  const map: Record<string, string> = {
    proposed: 'bg-amber-500/20 text-amber-400',
    pending: 'bg-blue-500/20 text-blue-400',
    win: 'bg-green-500/20 text-green-400',
    loss: 'bg-red-500/20 text-red-400',
    neutral: 'bg-zinc-500/20 text-zinc-400',
    rejected: 'bg-red-900/20 text-red-600',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${map[verdict] ?? 'bg-zinc-700/30 text-zinc-500'}`}>
      {verdict}
    </span>
  );
}

export default async function PullRequestsPage() {
  let rows: PRRow[] = [];
  let loadError: string | null = null;

  try {
    rows = await getOpenPRs();
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load PRs';
  }

  const openRows = rows.filter((r) => r.prState === 'open' || (!r.prState && r.change.verdict === 'proposed'));
  const closedRows = rows.filter((r) => r.prState !== 'open' && (r.prState || r.change.verdict !== 'proposed'));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pull Requests</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Agent-proposed code changes awaiting review — nothing merges without your approval
        </p>
      </div>

      {loadError && (
        <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-4 mb-6">
          <p className="text-red-400 text-sm">⚠ {loadError}</p>
          {loadError.includes('GITHUB_') && (
            <p className="text-zinc-500 text-xs mt-1">
              Make sure GITHUB_TOKEN, GITHUB_GREENHOUSE_REPO, and GITHUB_POPCORN_REPO are set in your environment.
            </p>
          )}
        </div>
      )}

      {rows.length === 0 && !loadError && (
        <div className="border border-white/10 rounded-xl bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400 font-medium">No agent PRs yet</p>
          <p className="text-zinc-600 text-sm mt-1">
            Ask the Growth Expert to propose a code-level change to a landing page template.
          </p>
          <Link
            href="/dashboard/chat"
            className="inline-block mt-4 text-sm border border-amber-500/30 text-amber-400 px-4 py-2 rounded-lg hover:border-amber-500/60 transition-colors"
          >
            ◆ Open Growth Expert
          </Link>
        </div>
      )}

      {openRows.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Open — {openRows.length}
          </h2>
          <PRTable rows={openRows} />
        </div>
      )}

      {closedRows.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Closed / Merged — {closedRows.length}
          </h2>
          <PRTable rows={closedRows} showActions={false} />
        </div>
      )}
    </div>
  );
}

function PRTable({ rows, showActions = true }: { rows: PRRow[]; showActions?: boolean }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10 bg-zinc-900/50">
            <th className="text-left text-xs text-zinc-500 font-medium px-5 py-3">Hypothesis</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Repo</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Variant</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Type</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">PR Status</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Verdict</th>
            <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Created</th>
            <th className="text-right text-xs text-zinc-500 font-medium px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.change.id} className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
              <td className="px-5 py-4">
                <p className="text-sm text-zinc-200 max-w-xs truncate">{row.change.hypothesis}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{row.projectName} / {row.verticalName}</p>
              </td>
              <td className="px-4 py-4">
                <span className="text-xs font-mono bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">
                  {row.change.github_repo ?? '—'}
                </span>
              </td>
              <td className="px-4 py-4">
                <span className="text-xs text-zinc-400 font-mono">{row.variantSlug}</span>
              </td>
              <td className="px-4 py-4">
                <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                  {row.change.change_type}
                </span>
              </td>
              <td className="px-4 py-4">
                {prStateBadge(row.prState, row.prMerged)}
              </td>
              <td className="px-4 py-4">
                {verdictBadge(row.change.verdict)}
              </td>
              <td className="px-4 py-4">
                <span className="text-xs text-zinc-500">
                  {new Date(row.change.implemented_at).toLocaleDateString()}
                </span>
              </td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-2 justify-end">
                  {row.change.pr_url && (
                    <a
                      href={row.change.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-400 hover:text-white border border-white/10 hover:border-white/20 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      View PR ↗
                    </a>
                  )}
                  {showActions && row.prState === 'open' && (
                    <>
                      <MergeButton changeId={row.change.id} />
                      <CloseButton changeId={row.change.id} />
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

