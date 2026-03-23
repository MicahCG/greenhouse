# Greenhouse Audit Response — Popcorn Ad Traffic Routing v2 (Post-Audit)

**Date:** March 23, 2026
**From:** Greenhouse engineering
**Re:** Popcorn's updated implementation document (March 23, 2026), reflecting fixes from our first audit

---

## Overall Assessment

All three audit fixes were applied correctly. The priority ordering, stale-pin handling, and `first_routing_method` tracking are in. We have **two items to flag** (one recommendation, one documentation note) and **one bug we found and fixed on our own side** during this review that Popcorn should be aware of.

The systems are compatible and ready for joint validation once Popcorn deploys.

---

## Fix Verification

### Fix 1: Priority ordering — VERIFIED CORRECT

Fresh ad click is now step 2 (before the existing cookie check in step 3). This matches our middleware's priority chain exactly. The Scenario A2 test case confirms the new ad overrides the old pin. No issues.

### Fix 2: Version-based ad pin validation — VERIFIED, WITH ONE NOTE

The approach of storing `{"variant":"slug","v":3}` in the cookie and validating against `config_version` is a sound design. It solves the killed-variant problem without requiring an extra API call per request.

**Noted difference in approach vs. Greenhouse:**

| | Greenhouse | Popcorn |
|---|---|---|
| **Ad pin cookie value** | Plain string (`variant-b`) | JSON (`{"variant":"variant-b","v":3}`) |
| **Stale pin detection** | Checks if variant slug is in the active variants list (DB query, cached 5 min) | Checks if stored version matches current config version (versions API, cached 60s) |
| **Invalidation precision** | Precise — only clears if the specific pinned variant was killed/paused | Broader — any config change to the vertical (weight change, new variant added) clears the pin |

**This divergence is acceptable.** The two systems operate on separate domains and never read each other's cookies. Popcorn's broader invalidation means some ad-pinned users will be reassigned after unrelated config changes, but they'll get a fresh fair assignment through the normal routing path, which may return the same variant if it's still active. The trade-off is reasonable given the constraint of not having `userId` in edge middleware.

**One thing to keep in mind:** If the Greenhouse dashboard team adjusts weights frequently (e.g., tuning a champion/challenger split), each weight change bumps `config_version`, which will clear all ad pin cookies for that vertical on Popcorn's side. If this causes unexpected churn in ad-pinned users, the fix would be to add a separate `ad_config_version` that only bumps when variants are added/removed/killed — not on weight changes. We can add this if it becomes a problem.

### Fix 3: `first_routing_method` — VERIFIED, WITH A RECOMMENDATION

The localStorage approach works for single-browser scenarios. However:

**Recommendation: Use Amplitude's `Identify.setOnce()` instead of localStorage.**

The localStorage approach has a cross-browser problem they acknowledged. If a user uses Chrome at work (first visit via ad → `first_routing_method: ad_pinned`) and Safari at home (organic visit → sends `first_routing_method: ab_assigned` via Segment identify), the Segment `identify` call will **overwrite** the Amplitude user property — defeating the set-once intent.

Amplitude's `setOnce` is evaluated server-side on Amplitude's user profile. Even if called from multiple browsers with different values, only the first value is persisted. This is the correct semantic.

```typescript
// Recommended: add alongside the existing Segment tracking
import { Identify, identify } from '@amplitude/analytics-browser';

const id = new Identify();
id.setOnce('first_routing_method', routingMethod);
identify(id);
```

This can coexist with their existing Segment `identify` calls for `last_routing_method`. Only `first_routing_method` needs the Amplitude SDK path.

**Priority: low.** The localStorage approach works for the majority case (single browser). But if Greenhouse dashboards start showing first-touch attribution data that looks inconsistent, this is likely the cause.

---

## Bug Found and Fixed on Greenhouse Side

During this audit, we discovered that our `source-detection.ts` (the function that sets the `traffic_source` Amplitude event property) was missing `ttclid` (TikTok) in its click ID checks. This meant:

- TikTok ad clicks were **correctly routed** as ad traffic (our `ad-routing.ts` includes `ttclid`)
- But the `traffic_source` property on Amplitude events was classified as `referral` or `direct` instead of `paid`

**Fixed:** `ttclid` is now included in `source-detection.ts`. Also added `tiktok` to the social platform referrer list so organic TikTok referrals are classified as `social` instead of `referral`.

**Impact on Popcorn:** If Popcorn copied our `source-detection.ts` (or a Segment equivalent), check that TikTok click IDs (`ttclid`) are included in your paid traffic detection for analytics purposes. The routing-side detection (`isAdTraffic`) already includes it on both sides — this is only about the analytics `traffic_source` classification.

---

## Cookie Format Compatibility — Confirmed Safe

Greenhouse and Popcorn now use different formats for the `gh_ad_pin_*` cookie:

| Domain | Format | Example |
|---|---|---|
| Greenhouse | Plain string | `variant-b` |
| Popcorn | JSON with version | `{"variant":"variant-b","v":3}` |

**This is safe** because the cookies exist on separate domains and are never read cross-domain. Each side parses its own cookies. Popcorn's legacy handling (parsing plain strings as `{variant: raw, v: 0}`) is a good defensive measure for any edge cases.

If we ever move to shared-domain cookies or cross-domain pinning in the future, we would need to align on a single format. For now, no action needed.

---

## Documentation Typo

In Scenario A, step 2:

```
gh_ad_pin_credit-store={"variant-b","v":3}
```

Should be:

```
gh_ad_pin_credit-store={"variant":"variant-b","v":3}
```

The `"variant"` key name is missing. Minor doc-only issue — the code is correct based on the Fix 2 description earlier in the document.

---

## Scenarios — All Validated

| Scenario | Verdict | Notes |
|---|---|---|
| **A:** Ad click → pin → return organic | Correct | |
| **A2:** Second ad click updates pin | Correct | Fix 1 working as intended |
| **B:** Greenhouse LP → Popcorn (cross-domain) | Correct | Independent cookies, confirmed |
| **C:** Ad traffic without `utm_content` | Correct | |
| **D:** `utm_content` targets `"all"` | Correct | |
| **E:** Config version change clears stale pin | Correct | Slightly aggressive but acceptable (see Fix 2 notes) |
| **F:** Greenhouse unreachable | Correct | Best-effort honors the pin |

---

## Resolved Items — Confirmed No Action Needed

| Item | Status |
|---|---|
| `x-gh-routing-method` header | Not needed on Popcorn — confirmed |
| Cross-domain cookie sharing | Not needed — confirmed |
| Ad signal list sync | Manual sync — confirmed |
| Vertical slug collision | Low risk, Greenhouse adding hyphen validation — confirmed |

---

## Summary

| Item | Status | Action |
|---|---|---|
| Fix 1 (priority ordering) | Applied correctly | None |
| Fix 2 (version-based pin validation) | Applied correctly | Monitor for churn from weight-change version bumps |
| Fix 3 (`first_routing_method`) | Applied, works for single-browser | Recommend switching to Amplitude `setOnce()` for cross-browser correctness |
| Greenhouse `ttclid` bug in source-detection | Fixed on our side | Popcorn: verify TikTok click IDs in your analytics `traffic_source` classification |
| Cookie format divergence | Safe (separate domains) | No action now, align if cross-domain sharing is ever needed |
| Doc typo in Scenario A | Cosmetic | Fix in their doc |

**Both systems are compatible and ready for joint validation.** No deployment ordering constraints. Confirm when deployed and we'll run the test scenarios.
