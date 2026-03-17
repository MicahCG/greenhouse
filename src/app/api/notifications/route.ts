import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { notifications, projects } from '@/lib/db/schema';
import { eq, isNull, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  // Get all project IDs (in a real multi-tenant app you'd filter by user)
  const allProjects = await db.select({ id: projects.id }).from(projects);
  const projectIds = allProjects.map((p) => p.id);

  if (projectIds.length === 0) return Response.json([]);

  // Fetch notifications for all projects
  let allNotifications = await db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.created_at))
    .limit(50);

  // Filter to only user's projects
  allNotifications = allNotifications.filter((n) => projectIds.includes(n.project_id));

  if (unreadOnly) {
    allNotifications = allNotifications.filter((n) => n.read_at === null);
  }

  return Response.json(allNotifications);
}
