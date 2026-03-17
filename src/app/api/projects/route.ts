import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  funnel_focus: z.enum(['acquisition', 'activation', 'monetization', 'retention', 'referral']),
  significance_threshold: z.number().min(0.8).max(0.99).optional().default(0.95),
  description: z.string().optional(),
  tracked_events: z.array(z.string()).length(2, 'Exactly 2 tracked events required (start and end)'),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const allProjects = await db.select().from(projects);

  const withCounts = await Promise.all(
    allProjects.map(async (project) => {
      const [{ value: verticalCount }] = await db
        .select({ value: count() })
        .from(verticals)
        .where(eq(verticals.project_id, project.id));

      const projectVerticals = await db
        .select({ id: verticals.id })
        .from(verticals)
        .where(eq(verticals.project_id, project.id));

      let variantCount = 0;
      for (const v of projectVerticals) {
        const [{ value }] = await db
          .select({ value: count() })
          .from(variants)
          .where(eq(variants.vertical_id, v.id));
        variantCount += value;
      }

      return { ...project, verticalCount, variantCount };
    })
  );

  return Response.json(withCounts);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { name, funnel_focus, significance_threshold, description, tracked_events } = parsed.data;

  const [project] = await db
    .insert(projects)
    .values({ name, funnel_focus, significance_threshold, description, tracked_events })
    .returning();

  return Response.json(project, { status: 201 });
}
