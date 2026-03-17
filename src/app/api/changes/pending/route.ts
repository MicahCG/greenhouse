import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  let rows;
  if (projectId) {
    rows = await db
      .select()
      .from(agent_changes)
      .where(
        and(
          eq(agent_changes.verdict, 'proposed'),
          eq(agent_changes.project_id, projectId)
        )
      );
  } else {
    rows = await db
      .select()
      .from(agent_changes)
      .where(eq(agent_changes.verdict, 'proposed'));
  }

  return Response.json({ changes: rows, count: rows.length });
}
