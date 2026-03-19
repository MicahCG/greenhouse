# Greenhouse Integration — Popcorn Implementation Guide

## What This Does

Greenhouse creates A/B variant pages (e.g., `/credits` vs `/credits2` vs `/credits3`) and controls traffic splitting. Popcorn needs to route authenticated users to their assigned variant URL. This guide covers everything needed on the Popcorn side.

## How It Works

1. When a user navigates to an experimentable page (e.g., `/credits`), middleware checks if they have an experiment assignment
2. If not, it calls the Greenhouse API with the user's Firebase UID
3. Greenhouse deterministically assigns a variant and returns the URL
4. Popcorn stores the assignment in a cookie and redirects to the assigned URL
5. The user always sees the same variant (persistent via cookie + Greenhouse DB)
6. Segment tracks which variant the user saw (flows to Amplitude for analysis)

---

## Step 1: Environment Variables

Add to `.env.local` and Vercel environment variables:

```
GREENHOUSE_API_URL=https://greenhouse-git-main-revel-xyz.vercel.app
GREENHOUSE_API_KEY=37db0a9870e4efc7a6fbf71c5f882c990578212d0587352cafbf2029ff9110a2
```

> **Note:** Update `GREENHOUSE_API_URL` to the production Greenhouse URL once you have a custom domain.

---

## Step 2: Greenhouse Client

Create `lib/greenhouse.ts`:

```typescript
const GREENHOUSE_API_URL = process.env.GREENHOUSE_API_URL;
const GREENHOUSE_API_KEY = process.env.GREENHOUSE_API_KEY;

export interface VariantAssignment {
  vertical_id: string;
  vertical_slug: string;
  variant_id: string;
  variant_slug: string;
  url: string | null;
  traffic_weight: number;
  assigned_at: string | null;
}

interface AssignmentsResponse {
  data: {
    user_id: string;
    assignments: Record<string, VariantAssignment>;
  };
}

/**
 * Fetch variant assignments for a user from Greenhouse.
 * Returns a map of vertical_slug → assignment.
 *
 * Example response:
 * {
 *   "credit-store": { variant_slug: "variant-b", url: "https://www.popcorn.co/credits2", ... },
 *   "growth-startups": { variant_slug: "variant-a", url: "https://www.popcorn.co/startupgrowth1", ... }
 * }
 */
export async function getExperimentAssignments(
  userId: string
): Promise<Record<string, VariantAssignment>> {
  if (!GREENHOUSE_API_URL || !GREENHOUSE_API_KEY) {
    console.warn('[Greenhouse] GREENHOUSE_API_URL or GREENHOUSE_API_KEY not set');
    return {};
  }

  try {
    const res = await fetch(
      `${GREENHOUSE_API_URL}/api/experiments/assignments?user_id=${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${GREENHOUSE_API_KEY}` },
        next: { revalidate: 300 }, // Cache for 5 min in Next.js Data Cache
      }
    );

    if (!res.ok) {
      console.warn(`[Greenhouse] Assignments API returned ${res.status}`);
      return {};
    }

    const body = (await res.json()) as AssignmentsResponse;
    return body.data.assignments;
  } catch (err) {
    console.warn('[Greenhouse] Failed to fetch assignments:', err);
    return {};
  }
}
```

---

## Step 3: Experiment Configuration

Create `lib/experiments.ts` — this maps which Popcorn routes are part of experiments:

```typescript
/**
 * Maps Popcorn routes to Greenhouse vertical slugs.
 *
 * When a user navigates to any of these paths, middleware will check
 * Greenhouse for their assigned variant and redirect if needed.
 *
 * Key: the URL path on popcorn.co (must match exactly)
 * Value: the Greenhouse vertical slug
 *
 * Add new entries here as you create new experiments in Greenhouse.
 */
export const EXPERIMENT_ROUTES: Record<string, string> = {
  '/credits': 'credit-store',
  // '/pricing': 'pricing-page',
  // '/onboarding': 'onboarding-flow',
};

/**
 * Reverse lookup: given a vertical slug, get the default (control) path.
 * Used to know which path is the "base" that might get redirected.
 */
export function getDefaultPath(verticalSlug: string): string | null {
  for (const [path, slug] of Object.entries(EXPERIMENT_ROUTES)) {
    if (slug === verticalSlug) return path;
  }
  return null;
}
```

---

## Step 4: Update Middleware

The existing middleware uses NextAuth's `withAuth`. Add experiment routing that runs after auth but before the page renders.

In `middleware.ts`, add the experiment check. The key logic:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { EXPERIMENT_ROUTES } from './lib/experiments';

// Cookie names for experiment assignments
const EXPERIMENT_COOKIE_PREFIX = 'gh_exp_';
const ASSIGNMENTS_FETCHED_COOKIE = 'gh_assignments_fetched';

/**
 * Call this inside your existing middleware function, AFTER auth is confirmed.
 * Returns a redirect response if the user should see a different variant,
 * or null if no redirect is needed.
 */
export function handleExperimentRouting(
  request: NextRequest,
  userId: string | undefined
): NextResponse | null {
  if (!userId) return null;

  const pathname = request.nextUrl.pathname;
  const verticalSlug = EXPERIMENT_ROUTES[pathname];

  // This path isn't part of any experiment
  if (!verticalSlug) return null;

  // Check if we have a cached assignment for this experiment
  const cookieName = `${EXPERIMENT_COOKIE_PREFIX}${verticalSlug}`;
  const assignedUrl = request.cookies.get(cookieName)?.value;

  if (assignedUrl) {
    // User has an assignment — redirect if it's a different URL
    try {
      const assignedPath = new URL(assignedUrl).pathname;
      if (assignedPath !== pathname) {
        return NextResponse.redirect(new URL(assignedPath, request.url));
      }
    } catch {
      // Invalid URL in cookie, fall through to fetch
    }
    return null; // Already on the correct variant
  }

  // No cached assignment — check if we already fetched (avoid infinite loop)
  if (request.cookies.get(ASSIGNMENTS_FETCHED_COOKIE)?.value === '1') {
    return null; // Already fetched, no assignment exists — serve default
  }

  // Fetch assignments from Greenhouse API (server-side, in middleware)
  // NOTE: Middleware runs on the Edge runtime. We need to fetch synchronously
  // via the rewrite pattern — redirect to an internal API route that does the fetch.
  const assignUrl = new URL('/api/experiments/resolve', request.url);
  assignUrl.searchParams.set('redirect_to', pathname);
  assignUrl.searchParams.set('vertical', verticalSlug);
  return NextResponse.rewrite(assignUrl);
}
```

**Important:** Edge Middleware can't make external API calls reliably in all environments. The pattern above rewrites to an internal API route that handles the Greenhouse API call. This is the recommended approach.

---

## Step 5: Internal API Route for Assignment Resolution

Create `app/api/experiments/resolve/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getExperimentAssignments } from '@/lib/greenhouse';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const EXPERIMENT_COOKIE_PREFIX = 'gh_exp_';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.firebaseUid; // Adjust to match your session shape

  const redirectTo = request.nextUrl.searchParams.get('redirect_to') ?? '/';
  const verticalSlug = request.nextUrl.searchParams.get('vertical');

  if (!userId || !verticalSlug) {
    // No auth or no experiment — just go to the requested page
    return NextResponse.redirect(new URL(redirectTo, request.url));
  }

  // Fetch all assignments from Greenhouse
  const assignments = await getExperimentAssignments(userId);

  // Build the response — redirect to the assigned variant (or the original page)
  const assignment = assignments[verticalSlug];
  let targetPath = redirectTo;

  if (assignment?.url) {
    try {
      targetPath = new URL(assignment.url).pathname;
    } catch {
      targetPath = redirectTo;
    }
  }

  const response = NextResponse.redirect(new URL(targetPath, request.url));

  // Cache ALL assignments as cookies so future navigations don't need API calls
  for (const [slug, a] of Object.entries(assignments)) {
    if (a.url) {
      response.cookies.set(`${EXPERIMENT_COOKIE_PREFIX}${slug}`, a.url, {
        maxAge: COOKIE_MAX_AGE,
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
      });
    }
  }

  // Mark that we've fetched assignments (prevents re-fetch loops)
  response.cookies.set('gh_assignments_fetched', '1', {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });

  return response;
}
```

---

## Step 6: Amplitude Tracking via Segment

After the user lands on their assigned variant page, fire a tracking event so Greenhouse can measure conversion rates.

In your analytics manager or a shared layout component, add:

```typescript
import { useFirebaseAuthContext } from '@/components/firebase-auth-provider';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { EXPERIMENT_ROUTES } from '@/lib/experiments';

/**
 * Hook: tracks experiment_page_viewed when the user lands on a variant page.
 * Place this in a layout component that wraps experimentable routes.
 */
export function useExperimentTracking() {
  const { user } = useFirebaseAuthContext();
  const pathname = usePathname();
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !pathname || tracked.current === pathname) return;

    // Check if this path is a variant page (either the control or a variant URL)
    // Read the assignment cookie to know which vertical this belongs to
    const cookies = document.cookie.split(';').reduce((acc, c) => {
      const [k, v] = c.trim().split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {} as Record<string, string>);

    // Find which experiment this path belongs to
    let verticalSlug: string | null = null;
    let variantUrl: string | null = null;

    // Check direct match (control paths)
    if (EXPERIMENT_ROUTES[pathname]) {
      verticalSlug = EXPERIMENT_ROUTES[pathname];
    }

    // Check cookies for variant assignments that point to this path
    for (const [key, value] of Object.entries(cookies)) {
      if (key.startsWith('gh_exp_')) {
        try {
          const assignedPath = new URL(decodeURIComponent(value)).pathname;
          if (assignedPath === pathname) {
            verticalSlug = key.replace('gh_exp_', '');
            variantUrl = value;
            break;
          }
        } catch {
          // not a URL cookie
        }
      }
    }

    if (!verticalSlug) return; // Not an experiment page

    tracked.current = pathname;

    // Fire Segment event (flows to Amplitude automatically)
    if (typeof window !== 'undefined' && window.analytics) {
      // Set user property for this experiment
      window.analytics.identify(user.uid, {
        [`experiment_${verticalSlug}`]: pathname,
      });

      // Track the page view with experiment context
      window.analytics.track('experiment_page_viewed', {
        vertical_slug: verticalSlug,
        variant_url: variantUrl ?? `https://www.popcorn.co${pathname}`,
        path: pathname,
      });
    }
  }, [user?.uid, pathname]);
}
```

Add `useExperimentTracking()` to the `(sidebar)/layout.tsx` component (or wherever shared layouts wrap experimentable pages).

---

## Step 7: Update Navigation Links (Optional Enhancement)

For the sidebar and any in-app links that point to experimentable pages, you can make them experiment-aware:

```typescript
// components/experiment-link.tsx
'use client';

import Link from 'next/link';
import { EXPERIMENT_ROUTES } from '@/lib/experiments';

const EXPERIMENT_COOKIE_PREFIX = 'gh_exp_';

/**
 * Drop-in replacement for Next.js Link that respects experiment assignments.
 * If the href is an experiment route and the user has an assignment cookie,
 * the link points to the assigned variant URL instead.
 */
export function ExperimentLink({
  href,
  children,
  ...props
}: React.ComponentProps<typeof Link>) {
  const path = typeof href === 'string' ? href : href.pathname ?? '';
  const verticalSlug = EXPERIMENT_ROUTES[path];

  if (verticalSlug && typeof window !== 'undefined') {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [key, value] = c.trim().split('=');
      if (key === `${EXPERIMENT_COOKIE_PREFIX}${verticalSlug}` && value) {
        try {
          const assignedPath = new URL(decodeURIComponent(value)).pathname;
          return <Link href={assignedPath} {...props}>{children}</Link>;
        } catch { /* fall through */ }
      }
    }
  }

  return <Link href={href} {...props}>{children}</Link>;
}
```

Usage (e.g., in `app-sidebar.tsx`):
```typescript
// Before:
<Link href="/credits">Credits</Link>

// After:
<ExperimentLink href="/credits">Credits</ExperimentLink>
```

This is optional — the middleware redirect handles routing regardless. But this avoids the brief redirect when clicking in-app links.

---

## Configuration Checklist

### Environment Variables
| Variable | Where | Value |
|---|---|---|
| `GREENHOUSE_API_URL` | Popcorn Vercel + .env.local | `https://greenhouse-git-main-revel-xyz.vercel.app` |
| `GREENHOUSE_API_KEY` | Popcorn Vercel + .env.local | `37db0a9870e4efc7a6fbf71c5f882c990578212d0587352cafbf2029ff9110a2` |

### Files to Create
| File | Purpose |
|---|---|
| `lib/greenhouse.ts` | Greenhouse API client |
| `lib/experiments.ts` | Route → experiment mapping |
| `app/api/experiments/resolve/route.ts` | Internal route for assignment resolution |
| `components/experiment-link.tsx` | Optional: experiment-aware Link component |

### Files to Modify
| File | Change |
|---|---|
| `middleware.ts` | Add `handleExperimentRouting()` call after auth check |
| `app/(sidebar)/layout.tsx` | Add `useExperimentTracking()` hook |

### Greenhouse Dashboard Setup
Before this works, make sure in Greenhouse:
1. The vertical exists (e.g., "Credit Store" with slug `credit-store`)
2. Variants exist with `external_url` set (e.g., variant-a → `/credits`, variant-b → `/credits2`)
3. Variants are set to `active` status
4. Traffic weights are configured (e.g., 50/50)

---

## How to Test

1. **API test** — Call the Greenhouse API directly:
   ```bash
   curl -H "Authorization: Bearer YOUR_KEY" \
     "https://greenhouse-url/api/experiments/assignments?user_id=test123"
   ```
   Verify you get variant assignments back.

2. **Cookie test** — Log in to Popcorn, navigate to `/credits`. Check cookies for `gh_exp_credit-store`. It should contain the assigned variant URL.

3. **Persistence test** — Navigate away and back to `/credits`. You should land on the same variant (cookie persists).

4. **Different user test** — Log in as a different user. They may get a different variant (depends on the hash).

5. **Amplitude test** — Check Amplitude for `experiment_page_viewed` events with `vertical_slug` and `path` properties.

6. **Kill test** — Kill a variant in Greenhouse. Clear the `gh_exp_*` cookies. Navigate to `/credits` again. The killed variant should no longer be assigned.

---

## Architecture Diagram

```
User clicks "Credits" in sidebar
         │
         ▼
┌─ Popcorn Middleware ──────────────────────────────┐
│                                                    │
│  1. Auth check (NextAuth) ← existing              │
│  2. Is /credits an experiment route?               │
│     └── YES: check cookie gh_exp_credit-store      │
│         ├── Cookie exists → redirect to variant    │
│         └── No cookie → rewrite to /api/resolve    │
│             └── Calls Greenhouse API               │
│                 └── Sets cookies + redirects        │
│                                                    │
└────────────────────────────────────────────────────┘
         │
         ▼
┌─ Variant Page Renders (/credits or /credits2) ────┐
│                                                    │
│  useExperimentTracking() fires:                    │
│  - Segment identify (experiment_credit-store)      │
│  - Segment track (experiment_page_viewed)          │
│                                                    │
└────────────────────────────────────────────────────┘
         │
         ▼
┌─ Greenhouse Dashboard ────────────────────────────┐
│                                                    │
│  Queries Amplitude for:                            │
│  - Visitors per variant (Viewed by path)           │
│  - Conversions per variant (proportional)          │
│  - experiment_page_viewed events                   │
│                                                    │
│  Shows: traffic split health, CVR, significance    │
│                                                    │
└────────────────────────────────────────────────────┘
```
