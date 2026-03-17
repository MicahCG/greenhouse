import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getPullRequestStatus, getDeploymentPreviewUrl } from '@/lib/github/client';
import { resolveRepo } from '@/lib/github/permissions';

export async function GET(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find all proposed code changes that have a PR
    const openChanges = await db
      .select()
      .from(agent_changes)
      .where(
        inArray(agent_changes.verdict, ['proposed'])
      );

    const codeChanges = openChanges.filter((c) => c.pr_number && c.github_repo);

    let merged = 0;
    let closed = 0;
    let errors = 0;

    for (const change of codeChanges) {
      try {
        const repoFull = resolveRepo(change.github_repo as 'greenhouse' | 'popcorn');
        const status = await getPullRequestStatus(repoFull, change.pr_number!);

        if (status.merged) {
          await db
            .update(agent_changes)
            .set({
              verdict: 'pending',
              commit_sha: status.mergedAt ?? null,
              implemented_at: status.mergedAt ? new Date(status.mergedAt) : new Date(),
            })
            .where(eq(agent_changes.id, change.id));
          merged++;
        } else if (status.state === 'closed' && !status.merged) {
          await db
            .update(agent_changes)
            .set({ verdict: 'rejected' })
            .where(eq(agent_changes.id, change.id));
          closed++;
        }
      } catch (err) {
        console.warn(`[sync-pr-status] Error checking PR for change ${change.id}:`, err);
        errors++;
      }
    }

    // Also fetch preview URLs for changes that have a branch but no preview_url yet
    let previewsFound = 0;
    const needsPreview = codeChanges.filter(
      (c) => c.branch_name && !c.preview_url && c.verdict === 'proposed'
    );

    for (const change of needsPreview) {
      try {
        const repoFull = resolveRepo(change.github_repo as 'greenhouse' | 'popcorn');
        const previewUrl = await getDeploymentPreviewUrl(repoFull, change.branch_name!);
        if (previewUrl) {
          await db
            .update(agent_changes)
            .set({ preview_url: previewUrl })
            .where(eq(agent_changes.id, change.id));
          previewsFound++;
        }
      } catch {
        // ignore preview URL fetch errors
      }
    }

    return Response.json({
      checked: codeChanges.length,
      merged,
      closed,
      errors,
      previews_found: previewsFound,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync-pr-status] Error:', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
