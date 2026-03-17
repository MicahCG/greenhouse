import { db } from '@/lib/db';
import { variants, verticals } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Rebalances traffic weights for all active variants in a vertical,
 * based on the vertical's traffic_split_strategy.
 */
export async function rebalanceWeights(verticalId: string): Promise<void> {
  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, verticalId))
    .limit(1);

  if (!vertical) return;

  const activeVariants = await db
    .select()
    .from(variants)
    .where(
      and(
        eq(variants.vertical_id, verticalId),
        inArray(variants.status, ['active', 'winner'])
      )
    );

  if (activeVariants.length === 0) return;

  const strategy = vertical.traffic_split_strategy;

  if (strategy === 'weighted') {
    // User controls weights — do not auto-rebalance
    return;
  }

  let newWeights: number[];

  if (strategy === 'champion_challenger') {
    // Winner (first alphabetically or first with 'winner' status) gets 80, rest split 20
    const winner = activeVariants.find((v) => v.status === 'winner') ?? activeVariants[0];
    const rest = activeVariants.filter((v) => v.id !== winner.id);

    if (rest.length === 0) {
      newWeights = [100];
    } else {
      const challengerWeight = Math.floor(20 / rest.length);
      const remainder = 20 - challengerWeight * rest.length;
      newWeights = activeVariants.map((v) => {
        if (v.id === winner.id) return 80;
        const idx = rest.indexOf(v);
        return challengerWeight + (idx === rest.length - 1 ? remainder : 0);
      });
    }
  } else {
    // 'equal' strategy: divide 100 evenly, last variant gets remainder
    const count = activeVariants.length;
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;
    newWeights = activeVariants.map((_, i) =>
      i === count - 1 ? base + remainder : base
    );
  }

  // Update all active variants
  await Promise.all(
    activeVariants.map((v, i) =>
      db
        .update(variants)
        .set({ traffic_weight: newWeights[i] })
        .where(eq(variants.id, v.id))
    )
  );
}
