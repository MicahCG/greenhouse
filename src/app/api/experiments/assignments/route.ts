import { db } from '@/lib/db';
import { user_assignments, variants, verticals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { pickVariantDeterministic } from '@/lib/experiments/assignment';

const QuerySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  vertical_slugs: z.string().optional(), // comma-separated, e.g. "credit-store,onboarding-flow"
});

/**
 * GET /api/experiments/assignments?user_id=xxx[&vertical_slugs=a,b]
 *
 * Returns variant assignments for a Popcorn user across active experiments.
 * Creates new assignments deterministically for verticals the user hasn't been assigned to yet.
 * Auth: Bearer token via GREENHOUSE_API_KEY.
 */
export async function GET(request: Request) {
  // 1. API key auth
  const apiKey = process.env.GREENHOUSE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GREENHOUSE_API_KEY is not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${apiKey}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse query params
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    user_id: url.searchParams.get('user_id'),
    vertical_slugs: url.searchParams.get('vertical_slugs') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const { user_id, vertical_slugs } = parsed.data;
  const slugFilter = vertical_slugs ? vertical_slugs.split(',').map((s) => s.trim()) : null;

  // 3. Look up existing assignments for this user
  const existingRows = await db
    .select({
      vertical_id: user_assignments.vertical_id,
      variant_id: user_assignments.variant_id,
      assigned_at: user_assignments.assigned_at,
      vertical_slug: verticals.slug,
      vertical_name: verticals.name,
      variant_slug: variants.slug,
      variant_type: variants.variant_type,
      variant_status: variants.status,
      external_url: variants.external_url,
      traffic_weight: variants.traffic_weight,
    })
    .from(user_assignments)
    .innerJoin(verticals, eq(user_assignments.vertical_id, verticals.id))
    .innerJoin(variants, eq(user_assignments.variant_id, variants.id))
    .where(eq(user_assignments.user_id, user_id));

  // Build a set of already-assigned vertical IDs
  const assignedVerticalIds = new Set(existingRows.map((r) => r.vertical_id));

  // 4. Find active verticals the user is NOT yet assigned to
  const allActiveVerticals = await db
    .select()
    .from(verticals)
    .where(eq(verticals.status, 'active'));

  // Filter to requested slugs if specified
  const targetVerticals = slugFilter
    ? allActiveVerticals.filter((v) => slugFilter.includes(v.slug))
    : allActiveVerticals;

  const unassignedVerticals = targetVerticals.filter((v) => !assignedVerticalIds.has(v.id));

  // 5. Assign variants for unassigned verticals
  const newAssignments: typeof existingRows = [];
  for (const vertical of unassignedVerticals) {
    const activeVariants = await db
      .select()
      .from(variants)
      .where(and(eq(variants.vertical_id, vertical.id), eq(variants.status, 'active')));

    if (activeVariants.length === 0) continue;

    const chosen = pickVariantDeterministic(user_id, vertical.id, activeVariants);

    // Persist (onConflictDoNothing handles race conditions)
    await db
      .insert(user_assignments)
      .values({ user_id, vertical_id: vertical.id, variant_id: chosen.id })
      .onConflictDoNothing();

    const chosenFull = activeVariants.find((v) => v.id === chosen.id)!;
    newAssignments.push({
      vertical_id: vertical.id,
      variant_id: chosen.id,
      assigned_at: new Date(),
      vertical_slug: vertical.slug,
      vertical_name: vertical.name,
      variant_slug: chosenFull.slug,
      variant_type: chosenFull.variant_type,
      variant_status: chosenFull.status,
      external_url: chosenFull.external_url,
      traffic_weight: chosenFull.traffic_weight,
    });
  }

  // 6. Combine existing + new, filter out killed/paused variant assignments
  const allRows = [...existingRows, ...newAssignments];

  // If a user's assigned variant was killed, reassign them
  const finalAssignments: Record<string, {
    vertical_id: string;
    vertical_slug: string;
    variant_id: string;
    variant_slug: string;
    url: string | null;
    traffic_weight: number;
    assigned_at: string | null;
  }> = {};

  for (const row of allRows) {
    // Skip if filtered by slug and not in the list
    if (slugFilter && !slugFilter.includes(row.vertical_slug)) continue;

    if (row.variant_status === 'killed') {
      // Variant was killed — reassign
      const activeVariants = await db
        .select()
        .from(variants)
        .where(and(eq(variants.vertical_id, row.vertical_id), eq(variants.status, 'active')));

      if (activeVariants.length === 0) continue;

      const newChoice = pickVariantDeterministic(user_id, row.vertical_id, activeVariants);

      // Update the assignment in DB
      await db
        .update(user_assignments)
        .set({ variant_id: newChoice.id, assigned_at: new Date() })
        .where(
          and(
            eq(user_assignments.user_id, user_id),
            eq(user_assignments.vertical_id, row.vertical_id)
          )
        );

      const chosenFull = activeVariants.find((v) => v.id === newChoice.id)!;
      finalAssignments[row.vertical_slug] = {
        vertical_id: row.vertical_id,
        vertical_slug: row.vertical_slug,
        variant_id: newChoice.id,
        variant_slug: chosenFull.slug,
        url: chosenFull.external_url,
        traffic_weight: chosenFull.traffic_weight,
        assigned_at: new Date().toISOString(),
      };
    } else {
      finalAssignments[row.vertical_slug] = {
        vertical_id: row.vertical_id,
        vertical_slug: row.vertical_slug,
        variant_id: row.variant_id,
        variant_slug: row.variant_slug,
        url: row.external_url,
        traffic_weight: row.traffic_weight,
        assigned_at: row.assigned_at?.toISOString() ?? null,
      };
    }
  }

  return Response.json({
    data: {
      user_id,
      assignments: finalAssignments,
    },
  });
}
