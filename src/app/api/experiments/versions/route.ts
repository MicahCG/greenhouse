import { db } from '@/lib/db';
import { verticals, variants } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * GET /api/experiments/versions
 *
 * Returns the current config_version for each active vertical that has
 * at least one active variant with an external URL. Popcorn polls this
 * frequently (~60s) to know if cached assignments are still valid.
 *
 * Auth: Bearer token via GREENHOUSE_API_KEY.
 */
export async function GET(request: Request) {
  const apiKey = process.env.GREENHOUSE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GREENHOUSE_API_KEY is not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${apiKey}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get active verticals
  const activeVerticals = await db
    .select({
      id: verticals.id,
      slug: verticals.slug,
      config_version: verticals.config_version,
    })
    .from(verticals)
    .where(eq(verticals.status, 'active'));

  if (activeVerticals.length === 0) {
    return Response.json({ data: {} });
  }

  // Find which verticals have at least one active external_url variant
  const verticalIds = activeVerticals.map((v) => v.id);
  const activeExternalVariants = await db
    .select({
      vertical_id: variants.vertical_id,
    })
    .from(variants)
    .where(
      and(
        inArray(variants.vertical_id, verticalIds),
        inArray(variants.status, ['active', 'winner']),
      )
    );

  const verticalsWithActiveVariants = new Set(activeExternalVariants.map((v) => v.vertical_id));

  // Build the version map: { vertical_slug: config_version }
  const versionMap: Record<string, number> = {};
  for (const v of activeVerticals) {
    if (verticalsWithActiveVariants.has(v.id)) {
      versionMap[v.slug] = v.config_version;
    }
  }

  return Response.json({ data: versionMap });
}
