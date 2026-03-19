import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { verticals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { deleteVerticalAssignments, incrementConfigVersion } from '@/lib/experiments/traffic';

/**
 * POST /api/verticals/[id]/reset-assignments
 *
 * Deletes all user_assignments for this vertical and increments config_version.
 * Forces every user to get a fresh assignment on their next visit.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, id))
    .limit(1);

  if (!vertical) return Response.json({ error: 'Not found' }, { status: 404 });

  const deletedCount = await deleteVerticalAssignments(id);
  const newVersion = await incrementConfigVersion(id);

  return Response.json({
    data: {
      deleted_assignments: deletedCount,
      config_version: newVersion,
    },
  });
}
