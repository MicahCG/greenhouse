import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { verticals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { forkPage } from '@/lib/github/fork-page';

const ForkVariantSchema = z.object({
  new_route: z.string().min(1, 'Route name is required'),
  text_replacements: z.array(z.object({
    find: z.string(),
    replace: z.string(),
  })).default([]),
  hypothesis: z.string().min(1, 'Hypothesis is required'),
  description: z.string().min(1, 'Description is required'),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: verticalId } = await params;

  // Load vertical and verify it has a source_file
  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, verticalId))
    .limit(1);

  if (!vertical) {
    return Response.json({ error: 'Vertical not found' }, { status: 404 });
  }

  if (!vertical.source_file) {
    return Response.json(
      { error: 'This vertical has no source file configured. Set a source file path in the vertical settings first.' },
      { status: 422 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ForkVariantSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const result = await forkPage({
      repoKey: 'popcorn',
      sourcePath: vertical.source_file,
      newRoute: parsed.data.new_route,
      textReplacements: parsed.data.text_replacements,
      verticalId,
      hypothesis: parsed.data.hypothesis,
      description: parsed.data.description,
      changedBy: 'user',
    });

    return Response.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fork-variant] Error:', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
