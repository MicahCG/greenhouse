import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ad_assignments } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

  const { daily_budget, start_date, end_date, notes, variant_id } = body as {
    daily_budget?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
    variant_id?: string | null;
  };

  const [existing] = await db
    .select()
    .from(ad_assignments)
    .where(eq(ad_assignments.id, id))
    .limit(1);

  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const updates: Partial<typeof ad_assignments.$inferInsert> = {};

  if (daily_budget !== undefined) updates.daily_budget = daily_budget;
  if (start_date !== undefined) updates.start_date = start_date ? new Date(start_date) : new Date();
  if (end_date !== undefined) updates.end_date = end_date ? new Date(end_date) : null;
  if (notes !== undefined) updates.notes = notes;
  if (variant_id !== undefined) updates.variant_id = variant_id;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  const [updated] = await db
    .update(ad_assignments)
    .set(updates)
    .where(eq(ad_assignments.id, id))
    .returning();

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [deleted] = await db
    .delete(ad_assignments)
    .where(eq(ad_assignments.id, id))
    .returning();

  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ success: true });
}
