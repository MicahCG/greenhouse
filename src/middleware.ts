import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';
import { isAdTraffic, parseVariantFromUtmContent, type RoutingMethod } from '@/lib/traffic/ad-routing';

const isDashboard = createRouteMatcher(['/dashboard(.*)']);

// Module-level caches (persist within edge worker instance)
const variantCache = new Map<string, { variants: Array<{ slug: string; weight: number }>; ts: number }>();
const adRouteCache = new Map<string, { variantSlug: string | null; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AD_PIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (ad attribution window)
const ORGANIC_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

/**
 * Look up the target variant for an ad assignment by utm_content_tag.
 * Queries the ad_assignments table and caches the result.
 */
async function getAdPinnedVariant(utmContent: string, verticalSlug: string): Promise<string | null> {
  const cacheKey = `${utmContent}:${verticalSlug}`;
  const cached = adRouteCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.variantSlug;

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT v.slug as variant_slug
    FROM ad_assignments aa
    JOIN verticals vert ON aa.vertical_id = vert.id
    JOIN variants v ON aa.variant_id = v.id
    WHERE aa.utm_content_tag = ${utmContent}
      AND vert.slug = ${verticalSlug}
      AND aa.status = 'active'
      AND v.status = 'active'
    LIMIT 1
  `;

  const variantSlug = rows.length > 0 ? String(rows[0].variant_slug) : null;
  adRouteCache.set(cacheKey, { variantSlug, ts: Date.now() });
  return variantSlug;
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

/**
 * Creates a response with the x-gh-routing-method header forwarded
 * to downstream server components.
 */
function rewriteWithRoutingMethod(
  req: NextRequest,
  url: URL,
  routingMethod: RoutingMethod
): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-gh-routing-method', routingMethod);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

function nextWithRoutingMethod(
  req: NextRequest,
  routingMethod: RoutingMethod
): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-gh-routing-method', routingMethod);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { pathname } = req.nextUrl;

  // Protect dashboard routes
  if (isDashboard(req)) {
    await auth.protect();
  }

  // -----------------------------------------------------------------------
  // Direct variant URL: /lp/[vertical]/[variant]
  // If the user arrives with ad params, set the ad pin cookie so return
  // visits through /lp/[vertical] will route to the same variant.
  // -----------------------------------------------------------------------
  const lpDirectMatch = pathname.match(/^\/lp\/([^/]+)\/([^/]+)\/?$/);
  if (lpDirectMatch) {
    const verticalSlug = lpDirectMatch[1];
    const variantSlug = lpDirectMatch[2];
    const searchParams = req.nextUrl.searchParams;

    if (isAdTraffic(searchParams)) {
      const adPinCookieName = `gh_ad_pin_${verticalSlug}`;
      const response = nextWithRoutingMethod(req, 'ad_pinned');
      response.cookies.set(adPinCookieName, variantSlug, {
        maxAge: AD_PIN_COOKIE_MAX_AGE,
        path: '/',
        sameSite: 'lax',
      });
      return response;
    }

    return nextWithRoutingMethod(req, 'direct');
  }

  // -----------------------------------------------------------------------
  // A/B traffic splitting: /lp/[vertical] (no variant segment)
  // Priority: ad click → ad pin cookie → organic cookie → new random
  // -----------------------------------------------------------------------
  const lpMatch = pathname.match(/^\/lp\/([^/]+)\/?$/);
  if (lpMatch) {
    const verticalSlug = lpMatch[1];
    const organicCookieName = `gh_variant_${verticalSlug}`;
    const adPinCookieName = `gh_ad_pin_${verticalSlug}`;

    const existingAdPin = req.cookies.get(adPinCookieName)?.value;
    const existingOrganic = req.cookies.get(organicCookieName)?.value;

    const searchParams = req.nextUrl.searchParams;
    const utmContent = searchParams.get('utm_content');
    const adTraffic = isAdTraffic(searchParams);

    let assignedVariant: string | null = null;
    let routingMethod: RoutingMethod = 'ab_assigned';
    let setAdPinCookie = false;
    let setOrganicCookie = false;

    // Priority 1: Current request has ad params → look up target variant
    if (adTraffic && utmContent) {
      let pinnedSlug: string | null = null;

      // Try DB lookup (canonical source: ad_assignments table)
      try {
        pinnedSlug = await getAdPinnedVariant(utmContent, verticalSlug);
      } catch (err) {
        console.warn('[middleware] Ad route DB lookup failed:', err);
      }

      // Fallback: parse variant slug from utm_content tag format
      if (!pinnedSlug) {
        pinnedSlug = parseVariantFromUtmContent(utmContent, verticalSlug);
      }

      if (pinnedSlug) {
        assignedVariant = pinnedSlug;
        routingMethod = 'ad_pinned';
        setAdPinCookie = true;
      }
    }

    // Priority 2: Existing ad pin cookie (return visit from ad user)
    // Validate that the pinned variant is still active before using it.
    if (!assignedVariant && existingAdPin) {
      try {
        const weights = await getVariantWeights(verticalSlug);
        const isStillActive = weights.some((w) => w.slug === existingAdPin);
        if (isStillActive) {
          assignedVariant = existingAdPin;
          routingMethod = 'ad_pinned';
        }
        // If the pinned variant was killed/paused, the cookie is stale — fall through
      } catch {
        // DB error — optimistically use the cookie to avoid breaking the user flow
        assignedVariant = existingAdPin;
        routingMethod = 'ad_pinned';
      }
    }

    // Priority 3: Existing organic cookie
    if (!assignedVariant && existingOrganic) {
      assignedVariant = existingOrganic;
      routingMethod = 'ab_assigned';
    }

    // Priority 4: New random assignment (organic traffic)
    if (!assignedVariant) {
      try {
        const weights = await getVariantWeights(verticalSlug);
        assignedVariant = pickVariant(weights);
        if (assignedVariant) {
          setOrganicCookie = true;
          routingMethod = 'ab_assigned';
        }
      } catch (err) {
        console.warn('[middleware] Failed to fetch variant weights from DB:', err);
      }
    }

    if (!assignedVariant) return NextResponse.next();

    const url = req.nextUrl.clone();
    url.pathname = `/lp/${verticalSlug}/${assignedVariant}`;

    const response = rewriteWithRoutingMethod(req, url, routingMethod);

    // Set ad pin cookie (7-day attribution window)
    if (setAdPinCookie) {
      response.cookies.set(adPinCookieName, assignedVariant, {
        maxAge: AD_PIN_COOKIE_MAX_AGE,
        path: '/',
        sameSite: 'lax',
      });
    }

    // Set organic cookie (30-day persistence)
    if (setOrganicCookie) {
      response.cookies.set(organicCookieName, assignedVariant, {
        maxAge: ORGANIC_COOKIE_MAX_AGE,
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
