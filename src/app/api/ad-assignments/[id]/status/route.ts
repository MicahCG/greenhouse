import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ad_assignments } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const StatusSchema = z.object({
  status: z.enum(['active', 'paused', 'ended']),
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

  const [existing] = await db
    .select()
    .from(ad_assignments)
    .where(eq(ad_assignments.id, id))
    .limit(1);

  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const [updated] = await db
    .update(ad_assignments)
    .set({ status: parsed.data.status })
    .where(eq(ad_assignments.id, id))
    .returning();

  return Response.json(updated);
}
