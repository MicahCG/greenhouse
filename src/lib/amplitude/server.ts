/**
 * Amplitude Analytics API v2 server-side wrapper.
 *
 * Auth: HTTP Basic with AMPLITUDE_API_KEY:AMPLITUDE_SECRET_KEY (base64).
 * If either env var is missing this module returns empty data and logs a warning
 * — it never throws so dashboards still render with real DB data.
 */

import { unstable_cache } from 'next/cache';

const BASE_URL = 'https://amplitude.com/api/2';

// Cache TTL: 30 minutes. unstable_cache persists across hot reloads and
// force-dynamic pages, preventing Amplitude rate-limit (429) errors.
const CACHE_TTL_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getAuthHeader(): string | null {
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  const encoded = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  return `Basic ${encoded}`;
}

function checkCredentials(): boolean {
  const ok =
    Boolean(process.env.AMPLITUDE_API_KEY) &&
    Boolean(process.env.AMPLITUDE_SECRET_KEY);
  if (!ok) {
    console.warn(
      '[Amplitude Server] AMPLITUDE_API_KEY or AMPLITUDE_SECRET_KEY is not set. ' +
        'Returning empty analytics data. Set these env vars to enable Amplitude queries.'
    );
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYYMMDD in the given IANA timezone.
 * Defaults to AMPLITUDE_TIMEZONE env var, then UTC.
 * Must match your Amplitude project's configured timezone — go to
 * Amplitude → Settings → Projects → [your project] → Timezone.
 */
function getAmplitudeTimezone(): string {
  return process.env.AMPLITUDE_TIMEZONE ?? 'UTC';
}

export function formatAmplitudeDate(date: Date, timeZone = getAmplitudeTimezone()): string {
  // Use Intl to format in the target timezone so day boundaries align with Amplitude
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}${m}${d}`;
}

/** Return start/end date strings for the last N days in the Amplitude project timezone */
export function getDateRange(windowDays: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (windowDays - 1));
  return { start: formatAmplitudeDate(start), end: formatAmplitudeDate(end) };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmplitudeFilter {
  subprop_type: 'event' | 'user';
  subprop_key: string;
  subprop_op: string;
  subprop_value: string[];
}

export interface EventTotalsResult {
  total: number;
  byGroup?: Record<string, number>;
  series?: Array<{ date: string; value: number }>;
}

export interface FunnelStep {
  event: string;
  count: number;
  conversionRate: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
}

export interface SeriesPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Internal fetch helper — wrapped in unstable_cache so results survive
// force-dynamic pages and hot reloads (avoids Amplitude 429 rate limits).
// ---------------------------------------------------------------------------

async function amplitudeFetchRaw(path: string, params: Record<string, string>): Promise<unknown> {
  const auth = getAuthHeader();
  if (!auth) return null;

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: auth, Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`[Amplitude Server] ${path} returned ${res.status}: ${body}`);
    // Throw on rate-limit so unstable_cache does NOT cache the failure
    if (res.status === 429) throw new Error(`Amplitude rate limited: ${body}`);
    return null;
  }

  return res.json();
}

/**
 * Cached wrapper around amplitudeFetchRaw.
 * unstable_cache persists results across hot reloads and force-dynamic pages.
 * Failures (thrown errors) are NOT cached — only successful responses are stored.
 */
const amplitudeFetch = unstable_cache(
  async (path: string, paramsStr: string): Promise<unknown> => {
    const params = JSON.parse(paramsStr) as Record<string, string>;
    return amplitudeFetchRaw(path, params);
  },
  ['amplitude-fetch'],
  { revalidate: CACHE_TTL_SECONDS }
);

// ---------------------------------------------------------------------------
// queryEventTotals
// ---------------------------------------------------------------------------

/**
 * Query Amplitude segmentation endpoint for event totals.
 * Optionally group by a single event property.
 */
export async function queryEventTotals(params: {
  event: string;
  start: string;
  end: string;
  groupBy?: string;
  filters?: AmplitudeFilter[];
  /** 'totals' counts every event fire; 'uniques' counts unique users. Default: 'totals' */
  metric?: 'totals' | 'uniques';
}): Promise<EventTotalsResult> {
  const empty: EventTotalsResult = { total: 0 };

  if (!checkCredentials()) return empty;

  try {
    // Separate event-level filters from user-level segment filters.
    // Event filters go inside the `e` parameter; user filters go in the `s` parameter.
    const eventFilters = (params.filters ?? []).filter((f) => f.subprop_type === 'event');
    const userFilters = (params.filters ?? []).filter((f) => f.subprop_type === 'user');

    const eventObj: { event_type: string; filters?: AmplitudeFilter[] } = {
      event_type: params.event,
    };
    if (eventFilters.length > 0) {
      eventObj.filters = eventFilters;
    }

    const queryParams: Record<string, string> = {
      e: JSON.stringify(eventObj),
      start: params.start,
      end: params.end,
      m: params.metric ?? 'totals',
      i: '1', // daily intervals
    };

    // User-level segment filters use Amplitude's `s` parameter
    if (userFilters.length > 0) {
      queryParams.s = JSON.stringify(userFilters.map((f) => ({
        prop: f.subprop_key,
        op: f.subprop_op,
        values: f.subprop_value,
      })));
    }

    if (params.groupBy) {
      queryParams.g = params.groupBy;
    }

    const raw = await amplitudeFetch('/events/segmentation', JSON.stringify(queryParams)) as {
      data?: {
        series: number[][];
        seriesLabels: (string | { value: string })[];
        xValues: string[];
      };
    } | null;

    if (!raw?.data) return empty;

    const { series, seriesLabels, xValues } = raw.data;

    // Sum totals across all days per group
    const totals = series.map((s) => s.reduce((a, b) => a + b, 0));
    const total = totals.reduce((a, b) => a + b, 0);

    // Build byGroup if we have multiple series (grouped query)
    let byGroup: Record<string, number> | undefined;
    if (params.groupBy && seriesLabels.length > 0) {
      byGroup = {};
      seriesLabels.forEach((label, i) => {
        const key = typeof label === 'object' ? label.value : String(label);
        byGroup![key] = totals[i] ?? 0;
      });
    }

    // Build daily series from first series (or aggregate if no groupBy)
    let dailySeries: Array<{ date: string; value: number }> | undefined;
    if (xValues.length > 0) {
      if (params.groupBy && series.length > 0) {
        // Aggregate across all groups per day
        dailySeries = xValues.map((date, di) => ({
          date,
          value: series.reduce((sum, s) => sum + (s[di] ?? 0), 0),
        }));
      } else if (series.length > 0) {
        dailySeries = xValues.map((date, di) => ({
          date,
          value: series[0][di] ?? 0,
        }));
      }
    }

    return { total, byGroup, series: dailySeries };
  } catch (err) {
    console.warn('[Amplitude Server] queryEventTotals error:', err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// queryFunnel
// ---------------------------------------------------------------------------

/**
 * Query Amplitude funnel endpoint.
 * Returns step-by-step conversion counts and rates.
 */
export async function queryFunnel(params: {
  events: string[];
  start: string;
  end: string;
  filters?: AmplitudeFilter[];
}): Promise<FunnelResult> {
  const empty: FunnelResult = {
    steps: params.events.map((event) => ({ event, count: 0, conversionRate: 0 })),
  };

  if (!checkCredentials()) return empty;
  if (params.events.length < 2) return empty;

  try {
    const queryParams: Record<string, string> = {
      e: JSON.stringify(params.events.map((name) => ({ event_type: name }))),
      start: params.start,
      end: params.end,
    };

    if (params.filters && params.filters.length > 0) {
      queryParams.s = JSON.stringify(params.filters);
    }

    const raw = await amplitudeFetch('/funnels', JSON.stringify(queryParams)) as {
      data?: {
        events?: Array<{ event: string; totals: number; conversion_rate?: number }>;
        steps?: Array<{ event: string; totals: number; conversion_rate?: number }>;
      };
    } | null;

    if (!raw?.data) return empty;

    // Amplitude can return results as `events` or `steps` depending on version
    const stepData = raw.data.events ?? raw.data.steps ?? [];

    const steps: FunnelStep[] = params.events.map((event, i) => {
      const step = stepData[i];
      return {
        event,
        count: step?.totals ?? 0,
        conversionRate: step?.conversion_rate ?? 0,
      };
    });

    return { steps };
  } catch (err) {
    console.warn('[Amplitude Server] queryFunnel error:', err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// queryEventSeries
// ---------------------------------------------------------------------------

/**
 * Query daily event count series.
 */
export async function queryEventSeries(params: {
  event: string;
  start: string;
  end: string;
  filters?: AmplitudeFilter[];
  metric?: 'totals' | 'uniques';
}): Promise<SeriesPoint[]> {
  if (!checkCredentials()) return [];

  try {
    const result = await queryEventTotals({
      event: params.event,
      start: params.start,
      end: params.end,
      filters: params.filters,
      metric: params.metric,
    });

    return result.series ?? [];
  } catch (err) {
    console.warn('[Amplitude Server] queryEventSeries error:', err);
    return [];
  }
}
