import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getDeploymentPreviewUrl } from '@/lib/github/client';
import { resolveRepo, isRepoKey } from '@/lib/github/permissions';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [change] = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.id, id))
    .limit(1);

  if (!change) {
    return Response.json({ error: 'Change not found' }, { status: 404 });
  }

  // If we already have a preview URL cached, return it
  if (change.preview_url) {
    return Response.json({ preview_url: change.preview_url });
  }

  // No cached URL — try to fetch from GitHub Deployments API
  if (!change.branch_name || !change.github_repo) {
    return Response.json({ preview_url: null });
  }

  const repoKey = change.github_repo;
  if (!isRepoKey(repoKey)) {
    return Response.json({ preview_url: null });
  }

  try {
    const repoFull = resolveRepo(repoKey);
    const previewUrl = await getDeploymentPreviewUrl(repoFull, change.branch_name);

    if (previewUrl) {
      // Cache it in the DB for future requests
      await db
        .update(agent_changes)
        .set({ preview_url: previewUrl })
        .where(eq(agent_changes.id, id));

      return Response.json({ preview_url: previewUrl });
    }
  } catch {
    // GitHub API may fail — return null gracefully
  }

  return Response.json({ preview_url: null });
}
