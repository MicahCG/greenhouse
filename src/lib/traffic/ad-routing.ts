/**
 * Ad traffic detection and routing utilities.
 * Used by middleware to detect paid traffic and pin users to the correct variant.
 */

/**
 * Detects whether a request comes from paid ad traffic.
 * Checks for: ad platform click IDs, paid UTM mediums.
 */
export function isAdTraffic(searchParams: URLSearchParams): boolean {
  // Ad platform click IDs
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

  // UTM medium indicating paid traffic
  const utmMedium = searchParams.get('utm_medium')?.toLowerCase();
  if (utmMedium && ['cpc', 'ppc', 'paid', 'paid_social', 'paid_search'].includes(utmMedium)) {
    return true;
  }

  return false;
}

/**
 * Extracts the variant slug from a Greenhouse utm_content tag.
 * Tag format: "{platform}-{format}-v{version}-{verticalSlug}-{variantSlug}"
 * Example: "meta-video-v1-creators-startup-growth" → "startup-growth"
 *
 * Returns null if the tag doesn't match the expected format or targets
 * all variants (variantSlug = "all").
 */
export function parseVariantFromUtmContent(
  utmContent: string,
  verticalSlug: string
): string | null {
  if (!utmContent) return null;

  // Expected format: {platform}-{format}-v{version}-{verticalSlug}-{variantSlug}
  // The variant slug may contain hyphens, so we find the vertical slug marker
  // and take everything after it.
  const verticalMarker = `-${verticalSlug}-`;
  const markerIndex = utmContent.indexOf(verticalMarker);
  if (markerIndex === -1) return null;

  const variantSlug = utmContent.slice(markerIndex + verticalMarker.length);
  if (!variantSlug || variantSlug === 'all') return null;

  return variantSlug;
}

export type RoutingMethod = 'ad_pinned' | 'ab_assigned' | 'direct';
