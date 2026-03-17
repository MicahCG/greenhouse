import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { notifications } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [updated] = await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(eq(notifications.id, id))
    .returning();

  if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ success: true });
}
