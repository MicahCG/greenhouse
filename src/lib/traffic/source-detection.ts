export type TrafficSource = 'organic' | 'paid' | 'direct' | 'referral' | 'social';

export function detectTrafficSource(
  searchParams: URLSearchParams,
  referrer: string
): TrafficSource {
  const utmMedium = searchParams.get('utm_medium');

  // 1. UTM medium is most reliable for paid
  if (utmMedium && ['cpc', 'ppc', 'paid', 'paid_social', 'paid_search'].includes(utmMedium)) {
    return 'paid';
  }

  // 2. Ad platform click IDs
  if (searchParams.has('gclid') || searchParams.has('gbraid') || searchParams.has('wbraid')) {
    return 'paid'; // Google
  }
  if (searchParams.has('fbclid')) return 'paid'; // Meta
  if (searchParams.has('li_fat_id')) return 'paid'; // LinkedIn

  // 3. UTM medium indicates organic social
  if (utmMedium === 'organic_social' || utmMedium === 'social') {
    return 'social';
  }

  // 4. Check referrer
  if (!referrer || referrer === '') return 'direct';

  let referrerHost: string;
  try {
    referrerHost = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'referral';
  }

  const searchEngines = ['google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex'];
  const socialPlatforms = ['facebook', 'instagram', 'linkedin'];

  if (searchEngines.some((se) => referrerHost.includes(se))) return 'organic';
  if (socialPlatforms.some((sp) => referrerHost.includes(sp))) return 'social';

  return 'referral';
}

export function parseUTMParams(searchParams: URLSearchParams) {
  return {
    utm_source: searchParams.get('utm_source') ?? '',
    utm_medium: searchParams.get('utm_medium') ?? '',
    utm_campaign: searchParams.get('utm_campaign') ?? '',
    utm_content: searchParams.get('utm_content') ?? '',
    utm_term: searchParams.get('utm_term') ?? '',
  };
}
