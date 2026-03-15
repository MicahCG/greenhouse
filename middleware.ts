import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isDashboard = createRouteMatcher(['/dashboard(.*)']);

// Variant weights cached at edge — populated from DB at build time via /api/variant-weights
// For Phase 1, we use a static fallback that mirrors our seed data.
// In production, this should be populated from the DB or a CDN-cached endpoint.
const STATIC_VARIANT_WEIGHTS: Record<string, Array<{ slug: string; weight: number }>> = {
  creators: [
    { slug: 'variant-a', weight: 50 },
    { slug: 'variant-b', weight: 50 },
  ],
  educators: [
    { slug: 'variant-a', weight: 50 },
    { slug: 'variant-b', weight: 50 },
  ],
};

function assignVariant(verticalSlug: string): string | null {
  const weights = STATIC_VARIANT_WEIGHTS[verticalSlug];
  if (!weights || weights.length === 0) return null;

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

    const assignedVariant = existingVariant ?? assignVariant(verticalSlug);
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
