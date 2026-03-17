/**
 * Bridge layer between dashboard UI and data sources (DB + Amplitude).
 * All functions catch errors and return safe fallback data.
 */

import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  queryEventTotals,
  queryFunnel,
  queryEventSeries,
  getDateRange,
  formatAmplitudeDate,
  type SeriesPoint,
} from '@/lib/amplitude/server';
import {
  calculateSignificance,
  calculateMinSampleSize,
  isEnoughData,
} from '@/lib/stats/significance';
import type { SignificanceResult } from '@/lib/stats/significance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerticalSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  variantCount: number;
  visitors: number;
  clicks: number;
  convRate: number;
}

export interface ProjectOverview {
  project: {
    id: string;
    name: string;
    status: string;
    funnel_focus: string;
    significance_threshold: number;
    created_at: Date | null;
  };
  totalVisitors: number;
  totalClicks: number;
  overallConvRate: number;
  verticals: VerticalSummary[];
}

export interface VariantMetrics {
  id: string;
  slug: string;
  version: number;
  status: string;
  traffic_weight: number;
  visitors: number;
  clicks: number;
  convRate: number;
  significance: SignificanceResult;
  sampleStatus: { enough: boolean; percentComplete: number };
}

export interface VerticalMetricsResult {
  vertical: {
    id: string;
    name: string;
    slug: string;
    status: string;
    traffic_split_strategy: string;
  };
  variants: VariantMetrics[];
  controlSlug: string;
}

export interface TimeSeriesPoint {
  date: string;
  visitors: number;
  clicks: number;
  convRate: number;
}

export interface TrafficSourceRow {
  source: string;
  visitors: number;
  pct: number;
}

export interface FunnelStep {
  event: string;
  label: string;
  count: number;
  conversionRate: number;
  dropOff: number;
}

export interface FunnelDataResult {
  steps: FunnelStep[];
  overallConvRate: number;
}

export interface TrafficOverviewResult {
  bySource: TrafficSourceRow[];
  byDevice: Array<{ device: string; visitors: number; pct: number }>;
  dailySeries: TimeSeriesPoint[];
  totalVisitors: number;
  organicPct: number;
  paidPct: number;
  topSource: string;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  'Page View': 'Page Views',
  'User Signed Up': 'Registrations',
  'Movie Created': 'Movies Created',
  'Channel Created': 'Channels Created',
  'Credits Purchased': 'Credit Purchases',
  lp_page_viewed: 'Page Views',
  lp_cta_clicked: 'CTA Clicks',
};

function labelForEvent(event: string): string {
  return EVENT_LABELS[event] ?? event;
}

/** Look up a project's tracked conversion events [startEvent, endEvent]. */
async function getTrackedEvents(projectId: string): Promise<[string, string]> {
  const [project] = await db
    .select({ tracked_events: projects.tracked_events })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const events = project?.tracked_events;
  if (events && events.length === 2) return [events[0], events[1]];
  // Fallback for legacy projects without tracked_events
  return ['Page View', 'User Signed Up'];
}

const ORGANIC_SOURCES = new Set(['organic', 'direct', 'seo', 'referral']);

// ---------------------------------------------------------------------------
// getProjectOverview
// ---------------------------------------------------------------------------

export async function getProjectOverview(projectId: string): Promise<ProjectOverview> {
  const fallback: ProjectOverview = {
    project: {
      id: projectId,
      name: 'Unknown',
      status: 'active',
      funnel_focus: 'acquisition',
      significance_threshold: 0.95,
      created_at: null,
    },
    totalVisitors: 0,
    totalClicks: 0,
    overallConvRate: 0,
    verticals: [],
  };

  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) return fallback;

    const allVerticals = await db
      .select()
      .from(verticals)
      .where(eq(verticals.project_id, projectId));

    const variantCounts = await Promise.all(
      allVerticals.map(async (v) => {
        const rows = await db
          .select()
          .from(variants)
          .where(eq(variants.vertical_id, v.id));
        return { verticalId: v.id, count: rows.length };
      })
    );
    const countMap = Object.fromEntries(
      variantCounts.map(({ verticalId, count }) => [verticalId, count])
    );

    const { start, end } = getDateRange(30);

    // Use the project's tracked conversion events
    const trackedEvents = project.tracked_events;
    const startEvent = trackedEvents && trackedEvents.length === 2 ? trackedEvents[0] : 'Page View';
    const endEvent = trackedEvents && trackedEvents.length === 2 ? trackedEvents[1] : 'User Signed Up';

    // Amplitude: start/end events grouped by vertical_id, filtered to project_id
    const [viewsResult, clicksResult] = await Promise.all([
      queryEventTotals({
        event: startEvent,
        start,
        end,
        groupBy: 'ep:vertical_id',
        filters: [{ subprop_type: 'event', subprop_key: 'project_id', subprop_op: 'is', subprop_value: [projectId] }],
      }),
      queryEventTotals({
        event: endEvent,
        start,
        end,
        groupBy: 'ep:vertical_id',
        filters: [{ subprop_type: 'event', subprop_key: 'project_id', subprop_op: 'is', subprop_value: [projectId] }],
      }),
    ]);

    const viewsByVertical = viewsResult.byGroup ?? {};
    const clicksByVertical = clicksResult.byGroup ?? {};

    const verticalSummaries: VerticalSummary[] = allVerticals.map((v) => {
      const visitors = viewsByVertical[v.id] ?? 0;
      const clicks = clicksByVertical[v.id] ?? 0;
      const convRate = visitors > 0 ? clicks / visitors : 0;
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        status: v.status,
        variantCount: countMap[v.id] ?? 0,
        visitors,
        clicks,
        convRate,
      };
    });

    const totalVisitors = viewsResult.total;
    const totalClicks = clicksResult.total;
    const overallConvRate = totalVisitors > 0 ? totalClicks / totalVisitors : 0;

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        funnel_focus: project.funnel_focus,
        significance_threshold: project.significance_threshold,
        created_at: project.created_at ?? null,
      },
      totalVisitors,
      totalClicks,
      overallConvRate,
      verticals: verticalSummaries,
    };
  } catch (err) {
    console.warn('[dashboard/queries] getProjectOverview error:', err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// getVerticalMetrics
// ---------------------------------------------------------------------------

export async function getVerticalMetrics(
  verticalId: string,
  windowDays = 30
): Promise<VerticalMetricsResult> {
  const fallback: VerticalMetricsResult = {
    vertical: {
      id: verticalId,
      name: 'Unknown',
      slug: '',
      status: 'active',
      traffic_split_strategy: 'equal',
    },
    variants: [],
    controlSlug: '',
  };

  try {
    const [vertical] = await db
      .select()
      .from(verticals)
      .where(eq(verticals.id, verticalId))
      .limit(1);

    if (!vertical) return fallback;

    const allVariants = await db
      .select()
      .from(variants)
      .where(eq(variants.vertical_id, verticalId));

    if (allVariants.length === 0) {
      return {
        vertical: {
          id: vertical.id,
          name: vertical.name,
          slug: vertical.slug,
          status: vertical.status,
          traffic_split_strategy: vertical.traffic_split_strategy,
        },
        variants: [],
        controlSlug: '',
      };
    }

    // Control = alphabetically first slug
    const sortedVariants = [...allVariants].sort((a, b) =>
      a.slug.localeCompare(b.slug)
    );
    const controlVariant = sortedVariants[0];

    const { start, end } = getDateRange(windowDays);

    // Look up tracked events from the parent project
    const [startEvent, endEvent] = await getTrackedEvents(vertical.project_id);

    // Determine query strategy: external URL variants use path-based tracking,
    // template variants use Greenhouse's vertical_id event property
    const hasExternalVariants = allVariants.some((v) => v.variant_type === 'external_url');
    const hasTemplateVariants = allVariants.some((v) => v.variant_type === 'template');

    let viewsByVariant: Record<string, number> = {};
    let clicksByVariant: Record<string, number> = {};

    if (hasExternalVariants) {
      // Build a map of URL paths → variant IDs for external variants
      const pathToVariantId: Record<string, string> = {};
      const paths: string[] = [];
      for (const v of allVariants) {
        if (v.external_url) {
          let path: string;
          try {
            path = new URL(v.external_url).pathname;
          } catch {
            path = v.external_url.startsWith('/') ? v.external_url : `/${v.external_url}`;
          }
          pathToVariantId[path] = v.id;
          paths.push(path);
        }
      }

      if (paths.length > 0) {
        // Query by page path instead of vertical_id
        const [viewsResult, clicksResult] = await Promise.all([
          queryEventTotals({
            event: startEvent,
            start,
            end,
            groupBy: 'ep:path',
            filters: [{ subprop_type: 'event', subprop_key: 'path', subprop_op: 'is', subprop_value: paths }],
          }),
          queryEventTotals({
            event: endEvent,
            start,
            end,
            groupBy: 'ep:path',
            filters: [{ subprop_type: 'event', subprop_key: 'path', subprop_op: 'is', subprop_value: paths }],
          }),
        ]);

        const viewsByPath = viewsResult.byGroup ?? {};
        const clicksByPath = clicksResult.byGroup ?? {};

        // Map path results back to variant IDs
        for (const [path, variantId] of Object.entries(pathToVariantId)) {
          viewsByVariant[variantId] = (viewsByVariant[variantId] ?? 0) + (viewsByPath[path] ?? 0);
          clicksByVariant[variantId] = (clicksByVariant[variantId] ?? 0) + (clicksByPath[path] ?? 0);
        }
      }
    }

    if (hasTemplateVariants) {
      // Greenhouse template variants: query by vertical_id event property
      const [viewsResult, clicksResult] = await Promise.all([
        queryEventTotals({
          event: startEvent,
          start,
          end,
          groupBy: 'ep:variant_id',
          filters: [{ subprop_type: 'event', subprop_key: 'vertical_id', subprop_op: 'is', subprop_value: [verticalId] }],
        }),
        queryEventTotals({
          event: endEvent,
          start,
          end,
          groupBy: 'ep:variant_id',
          filters: [{ subprop_type: 'event', subprop_key: 'vertical_id', subprop_op: 'is', subprop_value: [verticalId] }],
        }),
      ]);

      const templateViews = viewsResult.byGroup ?? {};
      const templateClicks = clicksResult.byGroup ?? {};
      for (const [id, count] of Object.entries(templateViews)) {
        viewsByVariant[id] = (viewsByVariant[id] ?? 0) + count;
      }
      for (const [id, count] of Object.entries(templateClicks)) {
        clicksByVariant[id] = (clicksByVariant[id] ?? 0) + count;
      }
    }

    const controlVisitors = viewsByVariant[controlVariant.id] ?? 0;
    const controlConversions = clicksByVariant[controlVariant.id] ?? 0;
    const controlConvRate =
      controlVisitors > 0 ? controlConversions / controlVisitors : 0;

    const baselineConvRate = Math.max(controlConvRate, 0.01);
    const minSampleSize = calculateMinSampleSize(baselineConvRate);

    const variantMetrics: VariantMetrics[] = allVariants.map((v) => {
      const visitors = viewsByVariant[v.id] ?? 0;
      const clicks = clicksByVariant[v.id] ?? 0;
      const convRate = visitors > 0 ? clicks / visitors : 0;

      const significance =
        v.id === controlVariant.id
          ? {
              pValue: 1,
              confidence: 0,
              relativeLift: 0,
              isSignificant: false,
              winner: 'none' as const,
            }
          : calculateSignificance(
              controlVisitors,
              controlConversions,
              visitors,
              clicks
            );

      const sampleStatus = isEnoughData(visitors, minSampleSize);

      return {
        id: v.id,
        slug: v.slug,
        version: v.version,
        status: v.status,
        traffic_weight: v.traffic_weight,
        visitors,
        clicks,
        convRate,
        significance,
        sampleStatus,
      };
    });

    return {
      vertical: {
        id: vertical.id,
        name: vertical.name,
        slug: vertical.slug,
        status: vertical.status,
        traffic_split_strategy: vertical.traffic_split_strategy,
      },
      variants: variantMetrics,
      controlSlug: controlVariant.slug,
    };
  } catch (err) {
    console.warn('[dashboard/queries] getVerticalMetrics error:', err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// getVariantTimeSeries
// ---------------------------------------------------------------------------

export async function getVariantTimeSeries(
  variantId: string,
  windowDays = 30
): Promise<TimeSeriesPoint[]> {
  try {
    // Look up tracked events via variant → vertical → project
    const [variant] = await db.select({ vertical_id: variants.vertical_id }).from(variants).where(eq(variants.id, variantId)).limit(1);
    if (!variant) return [];
    const [vertical] = await db.select({ project_id: verticals.project_id }).from(verticals).where(eq(verticals.id, variant.vertical_id)).limit(1);
    if (!vertical) return [];
    const [startEvent, endEvent] = await getTrackedEvents(vertical.project_id);

    const { start, end } = getDateRange(windowDays);
    const filters = [{ subprop_type: 'event' as const, subprop_key: 'variant_id', subprop_op: 'is', subprop_value: [variantId] }];

    const [viewsSeries, clicksSeries] = await Promise.all([
      queryEventSeries({ event: startEvent, start, end, filters }),
      queryEventSeries({ event: endEvent, start, end, filters }),
    ]);

    // Zip by date — use viewsSeries as the date index
    const clickMap = new Map(clicksSeries.map((p) => [p.date, p.value]));

    return viewsSeries.map((p) => {
      const visitors = p.value;
      const clicks = clickMap.get(p.date) ?? 0;
      const convRate = visitors > 0 ? clicks / visitors : 0;
      return { date: p.date, visitors, clicks, convRate };
    });
  } catch (err) {
    console.warn('[dashboard/queries] getVariantTimeSeries error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getVariantTrafficSources
// ---------------------------------------------------------------------------

export async function getVariantTrafficSources(
  variantId: string,
  windowDays = 30
): Promise<TrafficSourceRow[]> {
  try {
    // Look up tracked events via variant → vertical → project
    const [variant] = await db.select({ vertical_id: variants.vertical_id }).from(variants).where(eq(variants.id, variantId)).limit(1);
    let startEvent = 'Page View';
    if (variant) {
      const [vertical] = await db.select({ project_id: verticals.project_id }).from(verticals).where(eq(verticals.id, variant.vertical_id)).limit(1);
      if (vertical) {
        [startEvent] = await getTrackedEvents(vertical.project_id);
      }
    }

    const { start, end } = getDateRange(windowDays);

    const result = await queryEventTotals({
      event: startEvent,
      start,
      end,
      groupBy: 'ep:traffic_source',
      filters: [{ subprop_type: 'event', subprop_key: 'variant_id', subprop_op: 'is', subprop_value: [variantId] }],
    });

    const byGroup = result.byGroup ?? {};
    const total = Object.values(byGroup).reduce((a, b) => a + b, 0);

    if (total === 0) return [];

    return Object.entries(byGroup)
      .map(([source, visitors]) => ({
        source,
        visitors,
        pct: Math.round((visitors / total) * 100),
      }))
      .sort((a, b) => b.visitors - a.visitors);
  } catch (err) {
    console.warn('[dashboard/queries] getVariantTrafficSources error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getFunnelData
// ---------------------------------------------------------------------------

export async function getFunnelData(
  projectId: string,
  windowDays = 30
): Promise<FunnelDataResult> {
  const [startEvent, endEvent] = await getTrackedEvents(projectId);
  const eventNames = [startEvent, endEvent];
  const empty: FunnelDataResult = {
    steps: eventNames.map((event) => ({
      event,
      label: labelForEvent(event),
      count: 0,
      conversionRate: 0,
      dropOff: 0,
    })),
    overallConvRate: 0,
  };

  try {
    const { start, end } = getDateRange(windowDays);

    const result = await queryFunnel({
      events: eventNames,
      start,
      end,
      filters: [{ subprop_type: 'event', subprop_key: 'project_id', subprop_op: 'is', subprop_value: [projectId] }],
    });

    const steps: FunnelStep[] = result.steps.map((step, i) => {
      const prevCount = i > 0 ? result.steps[i - 1].count : step.count;
      const dropOff =
        prevCount > 0 && i > 0
          ? Math.round(((prevCount - step.count) / prevCount) * 100)
          : 0;
      return {
        event: step.event,
        label: labelForEvent(step.event),
        count: step.count,
        conversionRate: step.conversionRate,
        dropOff,
      };
    });

    const firstStep = steps[0]?.count ?? 0;
    const lastStep = steps[steps.length - 1]?.count ?? 0;
    const overallConvRate = firstStep > 0 ? lastStep / firstStep : 0;

    return { steps, overallConvRate };
  } catch (err) {
    console.warn('[dashboard/queries] getFunnelData error:', err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// getTrafficOverview
// ---------------------------------------------------------------------------

export async function getTrafficOverview(windowDays = 30): Promise<TrafficOverviewResult> {
  const empty: TrafficOverviewResult = {
    bySource: [],
    byDevice: [],
    dailySeries: [],
    totalVisitors: 0,
    organicPct: 0,
    paidPct: 0,
    topSource: 'N/A',
  };

  try {
    const { start, end } = getDateRange(windowDays);

    const [sourceResult, deviceResult, dailyResult] = await Promise.all([
      queryEventTotals({
        event: 'Page View',
        start,
        end,
        groupBy: 'ep:traffic_source',
      }),
      queryEventTotals({
        event: 'Page View',
        start,
        end,
        groupBy: 'ep:device_type',
      }),
      queryEventSeries({ event: 'Page View', start, end }),
    ]);

    // Derive total from the ungrouped daily series to avoid grouped-query undercounting
    // (events without a traffic_source property get excluded from grouped totals)
    const total = dailyResult.reduce((s, p) => s + p.value, 0);

    const bySource: TrafficSourceRow[] = Object.entries(
      sourceResult.byGroup ?? {}
    )
      .map(([source, visitors]) => ({
        source,
        visitors,
        pct: total > 0 ? Math.round((visitors / total) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors);

    const deviceTotal = deviceResult.total;
    const byDevice = Object.entries(deviceResult.byGroup ?? {})
      .map(([device, visitors]) => ({
        device,
        visitors,
        pct: deviceTotal > 0 ? Math.round((visitors / deviceTotal) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors);

    // Calculate organic vs paid percentages
    let organicVisitors = 0;
    let paidVisitors = 0;
    for (const row of bySource) {
      if (ORGANIC_SOURCES.has(row.source.toLowerCase())) {
        organicVisitors += row.visitors;
      } else {
        paidVisitors += row.visitors;
      }
    }
    const organicPct = total > 0 ? Math.round((organicVisitors / total) * 100) : 0;
    const paidPct = total > 0 ? Math.round((paidVisitors / total) * 100) : 0;
    const topSource = bySource[0]?.source ?? 'N/A';

    // Daily series with zero clicks (traffic overview only needs visitors)
    const dailySeries: TimeSeriesPoint[] = dailyResult.map((p) => ({
      date: p.date,
      visitors: p.value,
      clicks: 0,
      convRate: 0,
    }));

    return {
      bySource,
      byDevice,
      dailySeries,
      totalVisitors: total,
      organicPct,
      paidPct,
      topSource,
    };
  } catch (err) {
    console.warn('[dashboard/queries] getTrafficOverview error:', err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// getGrowthMetrics — the three KPI charts above the fold
// ---------------------------------------------------------------------------

export interface KpiMetric {
  daily: SeriesPoint[];
  total: number;
  prevTotal: number;
  avg: number;
  prevAvg: number;
  momChange: number; // month-over-month % change
}

export interface GrowthMetricsResult {
  visitors: KpiMetric;
  registrations: KpiMetric;
  purchases: KpiMetric;
  // Legacy flat fields for backwards compat with existing chart component
  visitorsDaily: SeriesPoint[];
  registrationsDaily: SeriesPoint[];
  purchasesDaily: SeriesPoint[];
  visitorsTotal: number;
  registrationsTotal: number;
  purchasesTotal: number;
}

function buildKpi(current: SeriesPoint[], previous: SeriesPoint[]): KpiMetric {
  const total = current.reduce((s, p) => s + p.value, 0);
  const prevTotal = previous.reduce((s, p) => s + p.value, 0);
  const days = current.length || 1;
  const prevDays = previous.length || 1;
  const avg = total / days;
  const prevAvg = prevTotal / prevDays;
  const momChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
  return { daily: current, total, prevTotal, avg, prevAvg, momChange };
}

/**
 * Daily series + MoM comparison for the three primary growth KPIs:
 *   1. Anonymous page views (pre-registration)  — "Page View" uniques, user_id not set
 *   2. New registrations                        — "User Signed Up" uniques
 *   3. Credit package purchases                 — "Credits Purchased" totals
 */
export async function getGrowthMetrics(windowDays = 30): Promise<GrowthMetricsResult> {
  const emptyKpi: KpiMetric = { daily: [], total: 0, prevTotal: 0, avg: 0, prevAvg: 0, momChange: 0 };
  const empty: GrowthMetricsResult = {
    visitors: emptyKpi, registrations: emptyKpi, purchases: emptyKpi,
    visitorsDaily: [], registrationsDaily: [], purchasesDaily: [],
    visitorsTotal: 0, registrationsTotal: 0, purchasesTotal: 0,
  };

  try {
    // Current period
    const { start, end } = getDateRange(windowDays);
    // Previous period (the 30 days before the current 30 days)
    const prevEnd = new Date();
    prevEnd.setDate(prevEnd.getDate() - windowDays);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (windowDays - 1));
    const prev = { start: formatAmplitudeDate(prevStart), end: formatAmplitudeDate(prevEnd) };

    const [
      visitorsRes, registrationsRes, purchasesRes,
      visitorsResPrev, registrationsResPrev, purchasesResPrev,
    ] = await Promise.all([
      queryEventSeries({ event: 'Page View', start, end, metric: 'uniques' }),
      queryEventSeries({ event: 'User Signed Up', start, end, metric: 'uniques' }),
      queryEventSeries({ event: 'Credits Purchased', start, end, metric: 'totals' }),
      queryEventSeries({ event: 'Page View', start: prev.start, end: prev.end, metric: 'uniques' }),
      queryEventSeries({ event: 'User Signed Up', start: prev.start, end: prev.end, metric: 'uniques' }),
      queryEventSeries({ event: 'Credits Purchased', start: prev.start, end: prev.end, metric: 'totals' }),
    ]);

    const visitors = buildKpi(visitorsRes, visitorsResPrev);
    const registrations = buildKpi(registrationsRes, registrationsResPrev);
    const purchases = buildKpi(purchasesRes, purchasesResPrev);

    return {
      visitors, registrations, purchases,
      visitorsDaily: visitorsRes,
      registrationsDaily: registrationsRes,
      purchasesDaily: purchasesRes,
      visitorsTotal: visitors.total,
      registrationsTotal: registrations.total,
      purchasesTotal: purchases.total,
    };
  } catch (err) {
    console.warn('[dashboard/queries] getGrowthMetrics error:', err);
    return empty;
  }
}
