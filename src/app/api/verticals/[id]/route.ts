import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { verticals, variants, variant_versions, agent_changes } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { rebalanceWeights } from '@/lib/experiments/traffic';

const PatchVerticalSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  traffic_split_strategy: z.enum(['equal', 'weighted', 'champion_challenger']).optional(),
});

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

  const parsed = PatchVerticalSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const updates: Partial<typeof verticals.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.traffic_split_strategy !== undefined) updates.traffic_split_strategy = parsed.data.traffic_split_strategy;

  const [updated] = await db.update(verticals).set(updates).where(eq(verticals.id, id)).returning();
  if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

  // Rebalance weights when strategy changes (equal or champion_challenger)
  if (parsed.data.traffic_split_strategy && parsed.data.traffic_split_strategy !== 'weighted') {
    await rebalanceWeights(id);
  }

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Delete dependent records first (no cascade in schema)
  const variantRows = await db.select({ id: variants.id }).from(variants).where(eq(variants.vertical_id, id));
  const variantIds = variantRows.map((v) => v.id);

  if (variantIds.length > 0) {
    // Delete variant_versions and agent_changes that reference these variants
    await db.delete(variant_versions).where(inArray(variant_versions.variant_id, variantIds));
    await db.delete(agent_changes).where(inArray(agent_changes.variant_id, variantIds));
    await db.delete(variants).where(eq(variants.vertical_id, id));
  }

  const [deleted] = await db
    .delete(verticals)
    .where(eq(verticals.id, id))
    .returning();

  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ success: true });
}
