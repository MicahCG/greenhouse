# Ad Traffic Routing — Popcorn Integration Guide

## Problem Statement

When users arrive from paid ads (Meta, Google, TikTok), they must land on the specific landing page the ad was designed for. Without special handling, Greenhouse's A/B middleware or Popcorn's experiment routing could redirect ad traffic to a different variant, wasting ad spend and corrupting campaign analytics.

This document explains the ad-pinned routing system implemented in Greenhouse and what Popcorn needs to do to stay compatible.

---

## How Ad-Pinned Routing Works (Greenhouse Side)

### Two types of traffic, two routing strategies

| Traffic type | How it arrives | Routing strategy | Cookie |
|---|---|---|---|
| **Ad traffic** | URL has UTM params + ad click IDs (`gclid`, `fbclid`, `ttclid`) | Pinned to the specific variant the ad targets | `gh_ad_pin_[vertical]` (7-day TTL) |
| **Organic traffic** | No ad signals in URL | Weighted random A/B assignment | `gh_variant_[vertical]` (30-day TTL) |

### Middleware priority chain

When a user hits `/lp/[vertical]` (Greenhouse-hosted landing pages), the middleware resolves the variant in this order:

1. **Current ad click** — Request has ad params + `utm_content` → DB lookup in `ad_assignments` table → pin to target variant
2. **Existing ad pin cookie** — `gh_ad_pin_[vertical]` is set from a previous ad click → use it
3. **Existing organic cookie** — `gh_variant_[vertical]` is set from a previous organic visit → use it
4. **New random assignment** — No cookies, no ad params → weighted random selection from active variants

### For direct variant URLs (`/lp/[vertical]/[variant]`)

When an ad links directly to the full variant URL (e.g., `/lp/creators/startup-growth?utm_source=meta&...`):
- The middleware does **not** rewrite the URL (it already includes the variant)
- If ad params are detected, it sets the `gh_ad_pin_[vertical]` cookie so future visits to `/lp/[vertical]` will route to the same variant
- The `x-gh-routing-method` header is set to `ad_pinned`

### The `utm_content` tag format

Greenhouse generates `utm_content` tags for ad assignments in this format:
```
{platform}-{format}-v{version}-{verticalSlug}-{variantSlug}
```
Examples:
- `meta-video-v1-creators-startup-growth`
- `google-responsive-v2-credit-store-variant-b`
- `tiktok-reel-v1-educators-all` (targets all variants, no pinning)

The middleware extracts the variant slug from this tag. If `variantSlug` is `all`, no pinning occurs.

### Ad traffic detection signals

The middleware considers a request as ad traffic if ANY of these are present:

| Signal | Platform |
|---|---|
| `gclid`, `gbraid`, `wbraid` | Google Ads |
| `fbclid` | Meta (Facebook/Instagram) |
| `ttclid` | TikTok Ads |
| `li_fat_id` | LinkedIn Ads |
| `utm_medium` = `cpc`, `ppc`, `paid`, `paid_social`, `paid_search` | Any platform |

### Amplitude tracking

Every landing page event (`lp_page_viewed`) now includes a `routing_method` property:

| Value | Meaning |
|---|---|
| `ad_pinned` | User was routed by ad traffic pinning (current click or cookie) |
| `ab_assigned` | User was routed by organic A/B weighted random assignment |
| `direct` | User navigated directly to a full variant URL without ad params |

User properties are also set:
- `first_routing_method` (set once) — how the user first arrived
- `last_routing_method` (updated every visit) — most recent routing method

---

## What Popcorn Needs to Do

### 1. Respect ad pin cookies in your middleware

If Popcorn's middleware handles experiment routing for authenticated users (via `gh_exp_[vertical]` cookies and Greenhouse API), it must also respect the ad pin cookie.

**Updated priority chain for Popcorn middleware:**

```
1. gh_ad_pin_[vertical] cookie exists → use it (ad-pinned, do NOT override)
2. gh_exp_[vertical] cookie exists → use it (existing experiment assignment)
3. No cookies → call Greenhouse API for assignment
```

**Implementation:**

In your middleware experiment routing function, add the ad pin check BEFORE the experiment cookie check:

```typescript
// In middleware.ts or wherever handleExperimentRouting lives

function handleExperimentRouting(
  request: NextRequest,
  userId: string | undefined
): NextResponse | null {
  if (!userId) return null;

  const pathname = request.nextUrl.pathname;
  const verticalSlug = EXPERIMENT_ROUTES[pathname];
  if (!verticalSlug) return null;

  // NEW: Check ad pin cookie first — ad traffic takes priority
  const adPinCookie = request.cookies.get(`gh_ad_pin_${verticalSlug}`)?.value;
  if (adPinCookie) {
    // The ad pin cookie contains a Greenhouse variant slug, not a Popcorn URL.
    // Look up the variant's external_url from the experiment assignment cache
    // or let the user stay on the current path (the ad already sent them here).
    //
    // If the user arrived from an ad to a Popcorn page, the ad URL already
    // points to the correct Popcorn route. The cookie just prevents future
    // organic visits from overriding this.
    return null; // Don't redirect — user is already ad-pinned
  }

  // Existing logic: check experiment cookie, fetch from Greenhouse API, etc.
  const cookieName = `${EXPERIMENT_COOKIE_PREFIX}${verticalSlug}`;
  const assignedUrl = request.cookies.get(cookieName)?.value;
  // ... rest of existing logic
}
```

### 2. Preserve UTM params through redirects

When your middleware redirects a user to a variant URL, **preserve the original query string**. Ad platforms append click IDs and UTM params that are needed for:
- Greenhouse ad detection
- Platform conversion tracking pixels
- Analytics attribution

```typescript
// BAD — drops UTM params
return NextResponse.redirect(new URL(assignedPath, request.url));

// GOOD — preserves UTM params
const target = new URL(assignedPath, request.url);
// Copy all search params from the original request
request.nextUrl.searchParams.forEach((value, key) => {
  target.searchParams.set(key, value);
});
return NextResponse.redirect(target);
```

### 3. Set the ad pin cookie when ad traffic arrives on Popcorn pages

If a user clicks an ad that links directly to a Popcorn page (e.g., `popcorn.co/credits?utm_source=meta&utm_content=meta-video-v1-credit-store-variant-b`), Popcorn's middleware should:

1. Detect ad traffic (same signals as Greenhouse — see table above)
2. Set the `gh_ad_pin_[vertical]` cookie with a 7-day TTL
3. Do NOT override this with a different experiment assignment

```typescript
import { isAdTraffic, parseVariantFromUtmContent } from './lib/ad-routing';

// In your middleware, before experiment routing:
function handleAdPinning(request: NextRequest): void {
  const searchParams = request.nextUrl.searchParams;
  if (!isAdTraffic(searchParams)) return;

  const utmContent = searchParams.get('utm_content');
  if (!utmContent) return;

  // Extract vertical slug from the current path
  const pathname = request.nextUrl.pathname;
  const verticalSlug = EXPERIMENT_ROUTES[pathname];
  if (!verticalSlug) return;

  // Parse the target variant from the utm_content tag
  const variantSlug = parseVariantFromUtmContent(utmContent, verticalSlug);
  if (!variantSlug) return;

  // Set the ad pin cookie (middleware sets this on the response)
  // Store this for the response — your middleware should set this cookie
  // on whatever response it returns.
}
```

**Ad routing utility** — copy or import these functions from Greenhouse:

```typescript
// lib/ad-routing.ts

export function isAdTraffic(searchParams: URLSearchParams): boolean {
  if (
    searchParams.has('gclid') ||
    searchParams.has('gbraid') ||
    searchParams.has('wbraid') ||
    searchParams.has('fbclid') ||
    searchParams.has('ttclid') ||
    searchParams.has('li_fat_id')
  ) {
    return true;
  }

  const utmMedium = searchParams.get('utm_medium')?.toLowerCase();
  if (utmMedium && ['cpc', 'ppc', 'paid', 'paid_social', 'paid_search'].includes(utmMedium)) {
    return true;
  }

  return false;
}

export function parseVariantFromUtmContent(
  utmContent: string,
  verticalSlug: string
): string | null {
  if (!utmContent) return null;

  const verticalMarker = `-${verticalSlug}-`;
  const markerIndex = utmContent.indexOf(verticalMarker);
  if (markerIndex === -1) return null;

  const variantSlug = utmContent.slice(markerIndex + verticalMarker.length);
  if (!variantSlug || variantSlug === 'all') return null;

  return variantSlug;
}
```

### 4. Add `routing_method` to your Segment/Amplitude tracking

When firing experiment-related analytics events, include the routing method so Greenhouse dashboards can segment by how users were routed.

```typescript
// In useExperimentTracking() or equivalent:

function getRoutingMethod(verticalSlug: string): 'ad_pinned' | 'ab_assigned' | 'direct' {
  const cookies = document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {} as Record<string, string>);

  if (cookies[`gh_ad_pin_${verticalSlug}`]) return 'ad_pinned';
  if (cookies[`gh_exp_${verticalSlug}`]) return 'ab_assigned';
  return 'direct';
}

// Include in tracking calls:
window.analytics.track('experiment_page_viewed', {
  vertical_slug: verticalSlug,
  variant_url: variantUrl,
  path: pathname,
  routing_method: getRoutingMethod(verticalSlug), // NEW
});

// Also set as user property:
window.analytics.identify(user.uid, {
  [`experiment_${verticalSlug}`]: pathname,
  last_routing_method: getRoutingMethod(verticalSlug), // NEW
});
```

---

## Cookie Reference

| Cookie | Set by | TTL | Contains | Purpose |
|---|---|---|---|---|
| `gh_ad_pin_[vertical]` | Greenhouse middleware OR Popcorn middleware | 7 days | Variant slug (e.g., `startup-growth`) | Pins ad traffic to intended variant |
| `gh_variant_[vertical]` | Greenhouse middleware | 30 days | Variant slug | Organic A/B assignment for Greenhouse-hosted LPs |
| `gh_exp_[vertical]` | Popcorn middleware | 30 days | Full variant URL | Experiment assignment for Popcorn-hosted pages |
| `gh_assignments_fetched` | Popcorn middleware | 30 days | `1` | Prevents re-fetching loop |

**Priority (highest to lowest):** `gh_ad_pin_*` > `gh_exp_*` / `gh_variant_*` > new assignment

---

## URL Conventions for Ad Campaigns

### Greenhouse-hosted landing pages

Ads should link to one of these patterns:

```
# Option A: Base vertical URL (middleware resolves variant from utm_content)
https://greenhouse-domain.com/lp/{vertical}?utm_source={platform}&utm_medium=cpc&utm_campaign={campaign}&utm_content={utm_content_tag}

# Option B: Direct variant URL (bypasses A/B split, most reliable)
https://greenhouse-domain.com/lp/{vertical}/{variant}?utm_source={platform}&utm_medium=cpc&utm_campaign={campaign}&utm_content={utm_content_tag}
```

**Recommendation:** Use Option B (direct variant URL) when the ad targets a specific variant. Use Option A only when the ad should participate in the A/B split.

### Popcorn-hosted pages (external URL variants)

Ads should link directly to the Popcorn page URL with full UTM params:

```
https://www.popcorn.co/credits?utm_source=meta&utm_medium=paid_social&utm_campaign=q1_growth&utm_content=meta-video-v1-credit-store-variant-b
```

Popcorn's middleware detects the ad traffic, sets `gh_ad_pin_credit-store=variant-b`, and does NOT redirect the user away.

---

## Architecture Diagram

```
                    ┌─────────────────────┐
                    │   Ad Platform       │
                    │  (Meta/Google/TT)   │
                    └──────────┬──────────┘
                               │
                    User clicks ad with UTM params
                               │
              ┌────────────────┼────────────────┐
              ▼                                  ▼
   Greenhouse-hosted LP                Popcorn-hosted page
   /lp/creators?utm_content=...       /credits?utm_content=...
              │                                  │
              ▼                                  ▼
   ┌─────────────────────┐          ┌─────────────────────┐
   │ Greenhouse MW       │          │ Popcorn MW          │
   │                     │          │                     │
   │ 1. Detect ad traffic│          │ 1. Detect ad traffic│
   │ 2. Lookup variant   │          │ 2. Set ad pin cookie│
   │    from ad_assn DB  │          │ 3. Skip experiment  │
   │ 3. Set ad pin cookie│          │    redirect         │
   │ 4. Rewrite to       │          │ 4. Serve page       │
   │    variant URL      │          │    directly         │
   │ 5. Set header:      │          │                     │
   │    x-gh-routing-    │          └──────────┬──────────┘
   │    method=ad_pinned │                     │
   └──────────┬──────────┘                     │
              │                                │
              ▼                                ▼
   ┌─────────────────────┐          ┌─────────────────────┐
   │ Landing Page        │          │ Popcorn Page        │
   │                     │          │                     │
   │ TrackingWrapper     │          │ useExperiment       │
   │ fires lp_page_viewed│          │ Tracking fires      │
   │ with routing_method │          │ experiment_page_    │
   │ = "ad_pinned"       │          │ viewed with         │
   │                     │          │ routing_method      │
   └──────────┬──────────┘          │ = "ad_pinned"      │
              │                     └──────────┬──────────┘
              │                                │
              └───────────┬────────────────────┘
                          ▼
               ┌─────────────────────┐
               │   Amplitude         │
               │                     │
               │ routing_method prop │
               │ enables segmenting: │
               │ - ad vs organic     │
               │ - verify ad routing │
               │ - clean A/B data    │
               └─────────────────────┘
```

---

## Verification: How to Confirm Ad Traffic Is Landing Correctly

### In Amplitude

1. **Segment by `routing_method`** on `lp_page_viewed` or `experiment_page_viewed` events
2. Filter to `routing_method = ad_pinned` → check that `variant_id` matches the intended variant for each `utm_content` value
3. Compare `routing_method = ad_pinned` traffic per variant against what ad platform reports as clicks

### In Greenhouse Dashboard

The traffic source breakdown per variant (already exists at variant detail pages) will show `paid` traffic. Cross-reference with ad spend records to confirm alignment.

### Quick smoke test

1. Construct a test URL with ad params:
   ```
   /lp/creators?utm_source=meta&utm_medium=cpc&utm_content=meta-video-v1-creators-startup-growth
   ```
2. Visit in an incognito window
3. Confirm you land on the `startup-growth` variant (not a random one)
4. Check cookies: `gh_ad_pin_creators` should be set to `startup-growth`
5. Clear the `utm_content` param and visit `/lp/creators` — should still land on `startup-growth` (cookie persists for 7 days)
6. Wait 7 days (or manually delete the cookie) — next organic visit should get random A/B assignment

---

## Files Changed in Greenhouse

| File | Change |
|---|---|
| `src/lib/traffic/ad-routing.ts` | **NEW** — `isAdTraffic()`, `parseVariantFromUtmContent()`, `RoutingMethod` type |
| `src/middleware.ts` | Ad-aware routing with dual cookie strategy and `x-gh-routing-method` header |
| `src/lib/amplitude/events.ts` | Added `routing_method` to `LPPageViewedProperties` |
| `src/components/landing-pages/tracking-wrapper.tsx` | Reads `routingMethod` prop, includes in events and user properties |
| `src/app/lp/[vertical]/[variant]/page.tsx` | Reads `x-gh-routing-method` header, passes to TrackingWrapper |

## Files to Create/Modify in Popcorn

| File | Change |
|---|---|
| `lib/ad-routing.ts` | **NEW** — Copy `isAdTraffic()` and `parseVariantFromUtmContent()` from Greenhouse |
| `middleware.ts` | Add ad pin cookie check before experiment routing; set ad pin cookie on ad traffic; preserve UTM params through redirects |
| Analytics hooks | Add `routing_method` to experiment tracking events and user properties |
