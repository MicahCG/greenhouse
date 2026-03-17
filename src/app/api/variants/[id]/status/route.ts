import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { rebalanceWeights } from '@/lib/experiments/traffic';

const StatusSchema = z.object({
  status: z.enum(['active', 'paused', 'killed', 'winner']),
  reason: z.string().optional(),
  pause_others: z.boolean().optional().default(false),
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

  const parsed = StatusSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const [existing] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const { status, pause_others } = parsed.data;

  await db
    .update(variants)
    .set({ status, updated_at: new Date() })
    .where(eq(variants.id, id));

  // If promoting winner and pause_others is true, pause sibling active variants
  if (status === 'winner' && pause_others) {
    const siblings = await db
      .select()
      .from(variants)
      .where(eq(variants.vertical_id, existing.vertical_id));

    await Promise.all(
      siblings
        .filter((v) => v.id !== id && v.status === 'active')
        .map((v) =>
          db.update(variants).set({ status: 'paused', updated_at: new Date() }).where(eq(variants.id, v.id))
        )
    );
  }

  // Rebalance weights after any status change
  await rebalanceWeights(existing.vertical_id);

  const [updated] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  return Response.json(updated);
}
