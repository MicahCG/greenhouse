import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { mergePullRequest } from '@/lib/github/client';
import { resolveRepo } from '@/lib/github/permissions';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [change] = await db
      .select()
      .from(agent_changes)
      .where(eq(agent_changes.id, id))
      .limit(1);

    if (!change) {
      return Response.json({ error: 'Change not found' }, { status: 404 });
    }

    if (!change.pr_number || !change.github_repo) {
      return Response.json({ error: 'This change has no associated PR' }, { status: 400 });
    }

    if (change.verdict !== 'proposed') {
      return Response.json({ error: `Change is already in state "${change.verdict}"` }, { status: 400 });
    }

    const repoFull = resolveRepo(change.github_repo as 'greenhouse' | 'popcorn');
    const commitSha = await mergePullRequest(
      repoFull,
      change.pr_number,
      `[Greenhouse] ${change.hypothesis}`
    );

    // Move to 'pending' — accountability tracking starts
    await db
      .update(agent_changes)
      .set({
        verdict: 'pending',
        commit_sha: commitSha || null,
        implemented_at: new Date(),
      })
      .where(eq(agent_changes.id, id));

    return Response.json({
      success: true,
      change_id: id,
      commit_sha: commitSha,
      verdict: 'pending',
      message: 'PR merged. Tracking will begin once traffic flows to the change.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pull-requests/merge] Error:', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
