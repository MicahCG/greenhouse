import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import {
  projects, verticals, variants, variant_versions,
  agent_changes, metric_snapshots, notifications,
  ad_spend_records, ad_creatives, ad_assignments,
} from '@/lib/db/schema';
import { eq, count, inArray } from 'drizzle-orm';
import { z } from 'zod';

const PatchProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
  significance_threshold: z.number().min(0.8).max(0.99).optional(),
  description: z.string().optional(),
  tracked_events: z.array(z.string()).length(2, 'Exactly 2 tracked events required (start and end)').optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return Response.json({ error: 'Not found' }, { status: 404 });

  const allVerticals = await db.select().from(verticals).where(eq(verticals.project_id, id));

  const verticalsWithVariants = await Promise.all(
    allVerticals.map(async (vertical) => {
      const allVariants = await db.select().from(variants).where(eq(variants.vertical_id, vertical.id));
      return { ...vertical, variants: allVariants };
    })
  );

  const [{ value: verticalCount }] = await db
    .select({ value: count() })
    .from(verticals)
    .where(eq(verticals.project_id, id));

  return Response.json({ ...project, verticalCount, verticals: verticalsWithVariants });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PatchProjectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const updates: Partial<typeof projects.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.significance_threshold !== undefined) updates.significance_threshold = parsed.data.significance_threshold;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.tracked_events !== undefined) updates.tracked_events = parsed.data.tracked_events;
  updates.updated_at = new Date();

  const [updated] = await db.update(projects).set(updates).where(eq(projects.id, id)).returning();
  if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return Response.json({ error: 'Not found' }, { status: 404 });

  // Cascade delete in dependency order
  const projectVerticals = await db.select({ id: verticals.id }).from(verticals).where(eq(verticals.project_id, id));
  const verticalIds = projectVerticals.map((v) => v.id);

  const projectVariants = verticalIds.length > 0
    ? await db.select({ id: variants.id }).from(variants).where(inArray(variants.vertical_id, verticalIds))
    : [];
  const variantIds = projectVariants.map((v) => v.id);

  const projectChanges = await db.select({ id: agent_changes.id }).from(agent_changes).where(eq(agent_changes.project_id, id));
  const changeIds = projectChanges.map((c) => c.id);

  const projectCreatives = await db.select({ id: ad_creatives.id }).from(ad_creatives).where(eq(ad_creatives.project_id, id));
  const creativeIds = projectCreatives.map((c) => c.id);

  // 1. metric_snapshots → agent_changes
  if (changeIds.length > 0) await db.delete(metric_snapshots).where(inArray(metric_snapshots.agent_change_id, changeIds));

  // 2. variant_versions → variants
  if (variantIds.length > 0) await db.delete(variant_versions).where(inArray(variant_versions.variant_id, variantIds));

  // 3. agent_changes → project
  await db.delete(agent_changes).where(eq(agent_changes.project_id, id));

  // 4. ad_assignments → verticals + ad_creatives
  if (verticalIds.length > 0) await db.delete(ad_assignments).where(inArray(ad_assignments.vertical_id, verticalIds));
  if (creativeIds.length > 0) await db.delete(ad_assignments).where(inArray(ad_assignments.ad_creative_id, creativeIds));

  // 5. ad_spend_records → project
  await db.delete(ad_spend_records).where(eq(ad_spend_records.project_id, id));

  // 6. notifications → project
  await db.delete(notifications).where(eq(notifications.project_id, id));

  // 7. ad_creatives → project
  await db.delete(ad_creatives).where(eq(ad_creatives.project_id, id));

  // 8. variants → verticals
  if (verticalIds.length > 0) await db.delete(variants).where(inArray(variants.vertical_id, verticalIds));

  // 9. verticals → project
  await db.delete(verticals).where(eq(verticals.project_id, id));

  // 10. project
  await db.delete(projects).where(eq(projects.id, id));

  return Response.json({ success: true });
}
