import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { collectSnapshot } from '@/lib/benchmarking/snapshot-collector';

export async function GET(request: Request) {
  // Auth: check CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Find all agent_changes with verdict = 'pending'
  const pendingChanges = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.verdict, 'pending'));

  let processed = 0;
  const errors: string[] = [];

  for (const change of pendingChanges) {
    try {
      await collectSnapshot(change.id, 'current');
      processed++;
    } catch (err) {
      errors.push(`${change.id}: ${String(err)}`);
    }
  }

  return Response.json({ processed, errors: errors.length > 0 ? errors : undefined });
}
