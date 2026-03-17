import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { verticals, variants } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';

const CreateVerticalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  description: z.string().optional(),
  source_url: z.string().url().optional(),
  source_file: z.string().optional(),
  traffic_split_strategy: z.enum(['equal', 'weighted', 'champion_challenger']).optional().default('equal'),
});

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;

  const allVerticals = await db
    .select()
    .from(verticals)
    .where(eq(verticals.project_id, projectId));

  const withCounts = await Promise.all(
    allVerticals.map(async (vertical) => {
      const [{ value: variantCount }] = await db
        .select({ value: count() })
        .from(variants)
        .where(eq(variants.vertical_id, vertical.id));
      return { ...vertical, variantCount };
    })
  );

  return Response.json(withCounts);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateVerticalSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { name, description, source_url, source_file, traffic_split_strategy } = parsed.data;
  let slug = parsed.data.slug ?? generateSlug(name);

  // Check slug uniqueness — try appending a counter if taken
  const existing = await db.select({ id: verticals.id }).from(verticals).where(eq(verticals.slug, slug)).limit(1);
  if (existing.length > 0) {
    let counter = 2;
    let candidateSlug = `${slug}-${counter}`;
    while (true) {
      const check = await db.select({ id: verticals.id }).from(verticals).where(eq(verticals.slug, candidateSlug)).limit(1);
      if (check.length === 0) { slug = candidateSlug; break; }
      counter++;
      candidateSlug = `${slug}-${counter}`;
    }
  }

  const [vertical] = await db
    .insert(verticals)
    .values({ project_id: projectId, slug, name, description, source_url, source_file, traffic_split_strategy })
    .returning();

  return Response.json(vertical, { status: 201 });
}
