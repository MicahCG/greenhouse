import { db } from '@/lib/db';
import { verticals, variants } from '@/lib/db/schema';
import { eq, and, inArray, isNotNull } from 'drizzle-orm';

/**
 * GET /api/experiments/routes
 *
 * Returns a mapping of ALL Popcorn paths that are part of experiments.
 * Popcorn uses this to dynamically know which routes need experiment handling.
 *
 * Response: { data: { routes: { "/credits": "credit-store", ... }, version: 5 } }
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
    return Response.json({ data: { routes: {}, version: 0 } });
  }

  const verticalIds = activeVerticals.map((v) => v.id);
  const verticalMap = new Map(activeVerticals.map((v) => [v.id, v]));

  // Get all active/winner variants with external URLs for these verticals
  const activeVariants = await db
    .select({
      vertical_id: variants.vertical_id,
      external_url: variants.external_url,
    })
    .from(variants)
    .where(
      and(
        inArray(variants.vertical_id, verticalIds),
        inArray(variants.status, ['active', 'winner']),
        isNotNull(variants.external_url),
      )
    );

  // Build routes map: { pathname: vertical_slug }
  const routes: Record<string, string> = {};
  let maxVersion = 0;

  for (const variant of activeVariants) {
    const vertical = verticalMap.get(variant.vertical_id);
    if (!vertical || !variant.external_url) continue;

    // Extract pathname from the URL
    try {
      const url = new URL(variant.external_url);
      routes[url.pathname] = vertical.slug;
    } catch {
      // If it's already a pathname (starts with /), use it directly
      if (variant.external_url.startsWith('/')) {
        routes[variant.external_url] = vertical.slug;
      }
    }

    if (vertical.config_version > maxVersion) {
      maxVersion = vertical.config_version;
    }
  }

  return Response.json({
    data: {
      routes,
      version: maxVersion,
    },
  });
}
