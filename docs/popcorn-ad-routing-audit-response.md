# Greenhouse Audit Response — Popcorn Ad Traffic Routing Implementation

**Date:** March 23, 2026
**From:** Greenhouse engineering
**Re:** Popcorn's "Ad Traffic Routing — Implementation Status" document (March 20, 2026)

---

## Overall Assessment

The implementation is solid and mostly compatible. We found **one routing bug** and **one missing validation** that need fixes before deployment, plus one analytics gap. Everything else is confirmed compatible.

---

## Compatibility Matrix

| Area | Status | Notes |
|---|---|---|
| Ad signal detection (`isAdTraffic`) | Compatible | Exact match with our implementation |
| `utm_content` tag parsing | Compatible | Same `indexOf` logic, same `"all"` handling |
| Cookie name format | Compatible | `gh_ad_pin_{vertical}` — matches |
| Cookie value format | Compatible | Plain variant slug string — matches |
| Cookie TTL | Compatible | 7 days (604800s) — matches |
| Cookie `path` / `sameSite` | Compatible | `/` and `lax` — matches |
| `routing_method` event property | Compatible | Same three values: `ad_pinned`, `ab_assigned`, `direct` |
| `routing_method` detection logic | Compatible | Same cookie-priority check |
| UTM param preservation | Compatible | Good fix, works with our system |
| Existing API integration (routes, versions, assignments) | Compatible | No changes needed to these endpoints |

---

## Bugs to Fix Before Deployment

### Bug 1: Priority ordering — fresh ad click must override existing ad pin cookie

**Severity:** High — causes wrong variant on return visits after a second ad click

**What's wrong:**

Your middleware checks the existing ad pin cookie (step 1) BEFORE checking for a fresh ad click (step 2). This means a new ad click cannot update a stale pin.

**Reproduction:**

```
Day 1: User clicks Meta ad for variant-a
       → gh_ad_pin_credit-store=variant-a cookie set
       → User sees /credits (variant-a page) ✓

Day 4: User clicks Google ad for variant-b
       → Arrives at /credits-v2?utm_content=google-responsive-v1-credit-store-variant-b&gclid=xyz
       → Your step 1: gh_ad_pin_credit-store cookie exists (variant-a) → stop, serve as-is
       → Cookie is NOT updated to variant-b
       → User sees /credits-v2 (correct for this visit, because the ad URL landed them here)

Day 5: User visits /credits organically (no ad params)
       → gh_ad_pin_credit-store=variant-a → routed to /credits (variant-a)
       → WRONG: Should be variant-b (the most recent ad intent)
```

**The fix — swap steps 1 and 2:**

```
// BEFORE (current, broken):
1. gh_ad_pin_{vertical} cookie exists? → Serve as-is.
2. Fresh ad click detected? → Set cookie, serve as-is.

// AFTER (fixed):
1. Fresh ad click detected? → Set/UPDATE gh_ad_pin cookie, serve as-is.
2. gh_ad_pin_{vertical} cookie exists? → Serve as-is.
3. gh_exp_{vertical} cookie (version matches) → Redirect.
...rest unchanged
```

This matches Greenhouse's middleware, where Priority 1 is always the fresh ad click (overrides everything) and Priority 2 is the existing ad pin cookie.

**Why this matters:** Advertisers pay per click. If a user clicks an ad for variant-b, the campaign is paying for that user to see variant-b going forward. Keeping them pinned to variant-a from an older campaign wastes the new campaign's spend and corrupts its conversion metrics.

---

### Bug 2: Stale ad pin cookie pointing to a killed/paused variant

**Severity:** Medium — causes 404s or incorrect routing after a variant is killed

**What's wrong:**

When the ad pin cookie fires (step 1 or 2 in your middleware), you serve the page as-is without verifying the pinned variant is still active. If the variant was killed or paused in Greenhouse since the cookie was set, the user either:
- Gets a 404 (if the page was removed)
- Sees a dead experiment page (if the page still exists but the experiment ended)

We had the same bug on our side and just fixed it. Our middleware now validates the ad pin cookie against the active variants list before trusting it:

```typescript
// In your middleware, when checking the ad pin cookie:
if (adPinCookie) {
  // Validate the pinned variant is still active
  const assignments = await getExperimentAssignments(userId);
  const assignment = assignments[verticalSlug];

  if (assignment && assignment.variant_slug === adPinCookie) {
    // Variant still active — honor the pin
    return null; // serve as-is
  } else {
    // Variant was killed/paused — clear stale cookie, fall through
    // (The response will clear the cookie via Set-Cookie)
    clearAdPinCookie = true;
    // Fall through to step 3 (gh_exp_ cookie) or step 6 (fetch assignment)
  }
}
```

Alternatively, if you want to avoid an API call on every request, you can validate against the config version: if the version has changed since the cookie was set, re-validate. This requires storing the version in the cookie value (e.g., `variant-b:3` instead of just `variant-b`).

The simpler approach: just let it fall through to the `gh_exp_` cookie or assignment fetch if the page returns a non-200. But proactive validation is better UX.

---

## Analytics Gap

### `first_routing_method` — please implement

**Priority:** Medium — needed for first-touch attribution analysis

Our dashboards use `first_routing_method` to answer questions like:
- "What percentage of users who eventually converted originally came from ads vs organic?"
- "Do ad-acquired users have different LTV than organically acquired users?"

Without this set-once property, we can only see the most recent routing method, which gets overwritten on every visit and doesn't tell us how the user was originally acquired.

**Implementation with Segment:**

```typescript
// Segment supports $set_once via the identify call with traits
window.analytics.identify(user.uid, {
  // These are "set" (overwrite every time):
  last_routing_method: routingMethod,
  [`experiment_${verticalSlug}`]: pathname,
}, {
  // Use integrations to pass set-once semantics to Amplitude:
  integrations: {
    Amplitude: {
      traits: {
        first_routing_method: { $setOnce: routingMethod },
      },
    },
  },
});
```

If Segment's `$setOnce` integration is cumbersome, an alternative: use the Amplitude Browser SDK directly for this one property:

```typescript
import { Identify, identify } from '@amplitude/analytics-browser';

const id = new Identify();
id.setOnce('first_routing_method', routingMethod);
identify(id);
```

---

## Answers to Your Open Questions

### Q1: Ad signal list sync — manual is fine

These signals change very rarely. The last major addition across the industry was TikTok's `ttclid`, and that was years ago. If we add a new signal, we'll update the integration doc and notify you. An API endpoint for this would be overengineering.

If you want a safety net: Greenhouse's `isAdTraffic()` function is the canonical source of truth. It lives at `src/lib/traffic/ad-routing.ts`. You can periodically diff your copy against ours to catch any additions.

### Q2: Cross-domain ad pin — not needed

Each domain is responsible for its own ad detection. This is correct and intentional.

- Ad targets Greenhouse LP → Greenhouse sets pin → Greenhouse-specific
- Ad targets Popcorn page → Popcorn sets pin → Popcorn-specific
- User who clicked a Greenhouse ad and later visits Popcorn organically → gets normal A/B assignment on Popcorn

These are independent experiments on independent domains. The ad URL determines which domain handles the pin. Cross-domain sharing would add complexity without a clear benefit since ads target a specific destination.

### Q3: Ad pin + version changes — correct, pins are independent of versioning

Ad pin cookies should NOT be invalidated by `config_version` bumps. A version change might update other variants' weights or add a new variant — that doesn't affect the pinned variant.

**Exception:** If the pinned variant itself is killed, the pin SHOULD be invalidated. This is Bug 2 above. The fix is to validate the variant is still active when using the cookie, not to tie it to the version number.

### Q4: Reporting pins back to Greenhouse — not needed

The `routing_method` property on Amplitude events gives us everything we need. When Popcorn fires `experiment_page_viewed` with `routing_method: "ad_pinned"`, that data flows to Amplitude and our dashboards can query it. No separate API call required.

### Q5: `first_routing_method` — yes, please implement

See the "Analytics Gap" section above. This is important for first-touch attribution.

### Q6: Vertical slug collision in `utm_content` parsing — low risk, acknowledged

You're correct that a vertical slug matching a platform or format name would break the `indexOf` parser. Example: a vertical called `video` would match the format segment in `meta-video-v1-video-variant-a` at the wrong position.

**Current risk: low.** Our existing verticals are all multi-word hyphenated slugs (`credit-store`, `growth-startups`, `faceless-video`, etc.). Platform names (`meta`, `google`, `tiktok`, `linkedin`) and format names (`video`, `image`, `carousel`, `text`, `story`, `reel`, `responsive`) are all single words.

**Mitigation we'll add:** A validation rule in the Greenhouse dashboard requiring vertical slugs to contain at least one hyphen. This structurally prevents collision with single-word platform/format names. We'll add this constraint to our vertical creation form and API validation.

---

## Items Confirmed — No Action Needed

| Item | Your assessment | Our response |
|---|---|---|
| `x-gh-routing-method` header not set on Popcorn | Correct, not needed | This header is internal to Greenhouse's server component pipeline. Popcorn doesn't need it. |
| Cross-domain cookies are independent | Correct | See Q2 above. |
| Ad traffic without `utm_content` → no pinning | Correct | Without `utm_content`, we can't determine which variant the ad targets. Normal A/B routing applies. This is Scenario C — confirmed correct. |
| `utm_content` targeting `"all"` → no pinning | Correct | Scenario D — confirmed correct. |
| Ad pin cookies independent of config versioning | Correct (with killed-variant exception) | Scenario E — confirmed correct, with Bug 2 caveat. |

---

## Test Scenarios — Validated

| Scenario | Their expected behavior | Greenhouse verdict |
|---|---|---|
| **A:** Ad click → Popcorn page → return organic | Serve pinned variant on return | Correct (after Bug 1 fix ensures fresh clicks update the pin) |
| **B:** Ad click → Greenhouse LP → later visit Popcorn | Popcorn assigns normally (cross-domain) | Correct |
| **C:** Ad traffic without `utm_content` | No pin, normal routing | Correct |
| **D:** `utm_content` targets `"all"` | No pin, normal routing | Correct |
| **E:** Stale ad pin + config version change | Ad pin wins, ignore version change | Correct (but add killed-variant check per Bug 2) |

---

## Summary of Required Changes

### Popcorn — must fix before deployment

| # | Change | Priority | Effort |
|---|---|---|---|
| 1 | **Swap middleware steps 1 and 2** — fresh ad click must override existing ad pin cookie | High | Small (reorder existing code) |
| 2 | **Validate ad pin cookie** — check variant is still active before trusting the cookie | Medium | Small (add one validation check) |
| 3 | **Implement `first_routing_method`** — set-once user property via Segment or Amplitude SDK | Medium | Small (add one identify call) |

### Greenhouse — already done

| # | Change | Status |
|---|---|---|
| 1 | Validate ad pin cookie against active variants list in middleware | Fixed (deployed with this response) |
| 2 | Add vertical slug validation (must contain hyphen) | Planned, will ship this week |

---

## Deployment Coordination

Once Popcorn applies the three fixes above, both sides can deploy independently. The systems communicate through:
1. **Cookies** (same naming convention, same format — verified compatible)
2. **Amplitude events** (same `routing_method` values — verified compatible)
3. **Existing API endpoints** (routes, versions, assignments — unchanged)

No new API endpoints or schema changes are needed. No deployment ordering constraints — Greenhouse's changes are backward-compatible and already merged.

Please confirm when the fixes are applied and we can run the joint test scenarios listed in your document.
