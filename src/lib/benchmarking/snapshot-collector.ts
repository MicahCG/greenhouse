import { db } from '@/lib/db';
import { metric_snapshots, agent_changes, variants, verticals, projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { queryEventTotals, getDateRange } from '@/lib/amplitude/server';

export async function collectSnapshot(
  agentChangeId: string,
  snapshotType: 'baseline' | 'current' | 'rolling_average'
): Promise<void> {
  // Fetch the agent_change to get variant_id and implemented_at
  const [change] = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.id, agentChangeId))
    .limit(1);

  if (!change) return;

  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.id, change.variant_id))
    .limit(1);

  if (!variant) return;

  // Determine the date window based on snapshot type
  let windowDays: number;
  let startDate: Date;
  let endDate: Date;

  const implementedAt = new Date(change.implemented_at);

  if (snapshotType === 'baseline') {
    // 14 days before the change was implemented
    windowDays = 14;
    endDate = new Date(implementedAt);
    endDate.setDate(endDate.getDate() - 1);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (windowDays - 1));
  } else if (snapshotType === 'current') {
    // From implementation date to now
    windowDays = Math.max(1, Math.ceil((Date.now() - implementedAt.getTime()) / (1000 * 60 * 60 * 24)));
    startDate = implementedAt;
    endDate = new Date();
  } else {
    // Rolling 7-day average
    windowDays = 7;
    const { start, end } = getDateRange(windowDays);
    startDate = new Date(start.slice(0, 4) + '-' + start.slice(4, 6) + '-' + start.slice(6, 8));
    endDate = new Date(end.slice(0, 4) + '-' + end.slice(4, 6) + '-' + end.slice(6, 8));
  }

  function formatDate(d: Date): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  // Look up the project's tracked events
  const [project] = await db
    .select({ tracked_events: projects.tracked_events })
    .from(projects)
    .where(eq(projects.id, change.project_id))
    .limit(1);
  const tracked = project?.tracked_events;
  const startEvent = tracked && tracked.length === 2 ? tracked[0] : 'Page View';
  const endEvent = tracked && tracked.length === 2 ? tracked[1] : 'User Signed Up';

  // Query Amplitude for visitors/conversions in that window
  const [viewsResult, clicksResult] = await Promise.all([
    queryEventTotals({
      event: startEvent,
      start,
      end,
      filters: [{ subprop_type: 'event' as const, subprop_key: 'variant_id', subprop_op: 'is', subprop_value: [change.variant_id] }],
    }),
    queryEventTotals({
      event: endEvent,
      start,
      end,
      filters: [{ subprop_type: 'event' as const, subprop_key: 'variant_id', subprop_op: 'is', subprop_value: [change.variant_id] }],
    }),
  ]);

  const visitors = viewsResult.total;
  const conversions = clicksResult.total;
  const conversion_rate = visitors > 0 ? conversions / visitors : 0;

  // Upsert: check if snapshot already exists
  const existing = await db
    .select()
    .from(metric_snapshots)
    .where(eq(metric_snapshots.agent_change_id, agentChangeId))
    .then((rows) => rows.find((r) => r.snapshot_type === snapshotType));

  if (existing) {
    await db
      .update(metric_snapshots)
      .set({ visitors, conversions, conversion_rate, captured_at: new Date() })
      .where(eq(metric_snapshots.id, existing.id));
  } else {
    await db.insert(metric_snapshots).values({
      agent_change_id: agentChangeId,
      snapshot_type: snapshotType,
      visitors,
      conversions,
      conversion_rate,
      window_days: windowDays,
    });
  }

  // Update samples_collected on agent_change (use current snapshot visitor count)
  if (snapshotType === 'current') {
    await db
      .update(agent_changes)
      .set({ samples_collected: visitors })
      .where(eq(agent_changes.id, agentChangeId));
  }
}
