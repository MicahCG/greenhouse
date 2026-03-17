import { db } from '@/lib/db';
import { agent_changes, metric_snapshots } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { calculateSignificance } from '@/lib/stats/significance';

export async function evaluateChange(
  agentChangeId: string
): Promise<'win' | 'loss' | 'neutral' | 'need_more_data'> {
  // 1. Fetch change + snapshots
  const [change] = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.id, agentChangeId))
    .limit(1);

  if (!change) return 'need_more_data';

  const snapshots = await db
    .select()
    .from(metric_snapshots)
    .where(eq(metric_snapshots.agent_change_id, agentChangeId));

  const baseline = snapshots.find((s) => s.snapshot_type === 'baseline');
  const current = snapshots.find((s) => s.snapshot_type === 'current');

  // 2. Check if samples < min_sample_size
  if (!current || current.visitors < change.min_sample_size) {
    return 'need_more_data';
  }

  if (!baseline || baseline.visitors === 0) {
    return 'need_more_data';
  }

  // 3. Calculate significance
  const significance = calculateSignificance(
    baseline.visitors,
    baseline.conversions,
    current.visitors,
    current.conversions
  );

  // 4. Determine verdict
  let verdict: 'win' | 'loss' | 'neutral' | 'need_more_data';

  if (!significance.isSignificant) {
    verdict = 'neutral';
  } else if (significance.winner === 'variant') {
    verdict = 'win';
  } else {
    verdict = 'loss';
  }

  // 5. Update agent_changes with verdict + confidence_level + evaluated_at
  await db
    .update(agent_changes)
    .set({
      verdict,
      confidence_level: significance.confidence,
      evaluated_at: new Date(),
    })
    .where(eq(agent_changes.id, agentChangeId));

  return verdict;
}
