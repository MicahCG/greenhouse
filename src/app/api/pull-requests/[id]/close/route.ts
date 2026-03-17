import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { closePullRequest } from '@/lib/github/client';
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

    const repoFull = resolveRepo(change.github_repo as 'greenhouse' | 'popcorn');
    await closePullRequest(repoFull, change.pr_number);

    await db
      .update(agent_changes)
      .set({ verdict: 'rejected' })
      .where(eq(agent_changes.id, id));

    return Response.json({ success: true, change_id: id, verdict: 'rejected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pull-requests/close] Error:', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
