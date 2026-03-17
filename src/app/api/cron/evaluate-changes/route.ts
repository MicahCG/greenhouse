import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { evaluateChange } from '@/lib/benchmarking/engine';

export async function GET(request: Request) {
  // Auth: check CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Find all pending changes that have collected enough samples
  const pendingChanges = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.verdict, 'pending'));

  // Filter to ones with enough samples
  const eligible = pendingChanges.filter(
    (c) => c.samples_collected >= c.min_sample_size
  );

  let processed = 0;
  const verdicts: Record<string, string> = {};
  const errors: string[] = [];

  for (const change of eligible) {
    try {
      const verdict = await evaluateChange(change.id);
      verdicts[change.id] = verdict;
      processed++;
    } catch (err) {
      errors.push(`${change.id}: ${String(err)}`);
    }
  }

  return Response.json({
    processed,
    verdicts,
    errors: errors.length > 0 ? errors : undefined,
  });
}
