import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { id } = await params;

  let reason = '';
  try {
    const body = await request.json() as { reason?: string };
    reason = body.reason ?? '';
  } catch {
    // reason stays empty
  }

  // Fetch the agent_change
  const [change] = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.id, id))
    .limit(1);

  if (!change) {
    return new Response(JSON.stringify({ error: 'Change not found' }), { status: 404 });
  }

  // Parse existing diff_summary to preserve proposed_changes + expected_impact
  let existingData: Record<string, unknown> = {};
  try {
    existingData = JSON.parse(change.diff_summary ?? '{}') as Record<string, unknown>;
  } catch {
    // ignore
  }

  const updatedDiffSummary = JSON.stringify({
    ...existingData,
    rejection_reason: reason,
  });

  await db
    .update(agent_changes)
    .set({
      verdict: 'rejected',
      diff_summary: updatedDiffSummary,
      evaluated_at: new Date(),
    })
    .where(eq(agent_changes.id, id));

  return Response.json({ success: true, verdict: 'rejected', reason });
}
