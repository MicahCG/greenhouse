import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

const isDashboard = createRouteMatcher(['/dashboard(.*)']);

// Module-level cache (persists within edge worker instance)
const variantCache = new Map<string, { variants: Array<{ slug: string; weight: number }>; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getVariantWeights(verticalSlug: string): Promise<Array<{ slug: string; weight: number }>> {
  const cached = variantCache.get(verticalSlug);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.variants;

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT v.slug, v.traffic_weight as weight
    FROM variants v
    JOIN verticals vert ON v.vertical_id = vert.id
    WHERE vert.slug = ${verticalSlug} AND v.status = 'active'
    ORDER BY v.slug
  `;

  const variants = rows.map((r) => ({ slug: String(r.slug), weight: Number(r.weight) }));
  variantCache.set(verticalSlug, { variants, ts: Date.now() });
  return variants;
}

function pickVariant(weights: Array<{ slug: string; weight: number }>): string | null {
  if (weights.length === 0) return null;

  const total = weights.reduce((sum, v) => sum + v.weight, 0);
  let rand = Math.random() * total;

  for (const variant of weights) {
    rand -= variant.weight;
    if (rand <= 0) return variant.slug;
  }

  return weights[weights.length - 1].slug;
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { pathname } = req.nextUrl;

  // Protect dashboard routes
  if (isDashboard(req)) {
    await auth.protect();
  }

  // A/B traffic splitting for /lp/[vertical] (no variant segment)
  const lpMatch = pathname.match(/^\/lp\/([^/]+)\/?$/);
  if (lpMatch) {
    const verticalSlug = lpMatch[1];
    const cookieName = `gh_variant_${verticalSlug}`;
    const existingVariant = req.cookies.get(cookieName)?.value;

    let assignedVariant: string | null = null;

    if (existingVariant) {
      assignedVariant = existingVariant;
    } else {
      try {
        const weights = await getVariantWeights(verticalSlug);
        assignedVariant = pickVariant(weights);
      } catch (err) {
        console.warn('[middleware] Failed to fetch variant weights from DB:', err);
        assignedVariant = null;
      }
    }

    if (!assignedVariant) return NextResponse.next();

    const url = req.nextUrl.clone();
    url.pathname = `/lp/${verticalSlug}/${assignedVariant}`;

    const response = NextResponse.rewrite(url);

    // Set cookie if newly assigned
    if (!existingVariant) {
      response.cookies.set(cookieName, assignedVariant, {
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
        sameSite: 'lax',
      });
    }

    return response;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
