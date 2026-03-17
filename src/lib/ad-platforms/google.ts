/**
 * Google Ads API v17 via REST
 * Env vars: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *           GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
 *
 * Gracefully returns empty data when credentials are missing.
 */

// ---------------------------------------------------------------------------
// In-process 15-minute cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleCampaign {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function checkGoogleCredentials(): boolean {
  const ok =
    Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()) &&
    Boolean(process.env.GOOGLE_ADS_CLIENT_ID?.trim()) &&
    Boolean(process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()) &&
    Boolean(process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()) &&
    Boolean(process.env.GOOGLE_ADS_CUSTOMER_ID?.trim());
  if (!ok) {
    console.warn(
      '[Google Ads] One or more Google Ads env vars are not set ' +
        '(GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, ' +
        'GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID). ' +
        'Returning empty ad data.'
    );
  }
  return ok;
}

// ---------------------------------------------------------------------------
// OAuth2 token refresh
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(): Promise<string | null> {
  const cacheKey = 'google_access_token';
  const cached = cacheGet<string>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!.trim(),
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!.trim(),
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn('[Google Ads] Token refresh failed:', res.status, await res.text());
      return null;
    }

    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;

    // Cache for slightly less than the expiry time (default 3600s → cache 50 min)
    const ttl = ((json.expires_in ?? 3600) - 600) * 1000;
    cache.set(cacheKey, { value: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  } catch (err) {
    console.warn('[Google Ads] getGoogleAccessToken error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// getGoogleCampaigns
// ---------------------------------------------------------------------------

export async function getGoogleCampaigns(
  dateRange: { start: string; end: string }
): Promise<GoogleCampaign[]> {
  if (!checkGoogleCredentials()) return [];

  const cacheKey = JSON.stringify({ fn: 'getGoogleCampaigns', dateRange });
  const cached = cacheGet<GoogleCampaign[]>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) return [];

    // Trim whitespace + strip dashes (API expects 10-digit format: 1234567890)
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.trim().replace(/-/g, '');
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim();

    const query =
      `SELECT campaign.id, campaign.name, campaign.status, ` +
      `metrics.cost_micros, metrics.impressions, metrics.clicks, ` +
      `metrics.ctr, metrics.conversions ` +
      `FROM campaign WHERE segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'`;

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      console.warn('[Google Ads] search request failed:', res.status, await res.text());
      return [];
    }

    const json = await res.json() as {
      results?: Array<{
        campaign?: { id?: string; name?: string; status?: string };
        metrics?: {
          costMicros?: string;
          impressions?: string;
          clicks?: string;
          ctr?: number;
          conversions?: number;
        };
      }>;
    };

    const campaigns: GoogleCampaign[] = (json.results ?? []).map((row) => {
      const costMicros = Number(row.metrics?.costMicros ?? 0);
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const spend = costMicros / 1_000_000;
      return {
        id: row.campaign?.id ?? '',
        name: row.campaign?.name ?? '',
        status: row.campaign?.status ?? '',
        spend,
        impressions,
        clicks,
        ctr: row.metrics?.ctr ?? (impressions > 0 ? clicks / impressions : 0),
        cpc: clicks > 0 ? spend / clicks : 0,
        conversions: row.metrics?.conversions ?? 0,
      };
    });

    cacheSet(cacheKey, campaigns);
    return campaigns;
  } catch (err) {
    console.warn('[Google Ads] getGoogleCampaigns error:', err);
    return [];
  }
}
