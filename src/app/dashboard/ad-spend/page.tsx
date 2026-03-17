export const dynamic = 'force-dynamic';

import { getAllCampaigns, getAdDateRange } from '@/lib/ad-platforms/unified';
import { db } from '@/lib/db';
import {
  ad_spend_records,
  ad_creatives,
  ad_assignments,
  projects,
  verticals,
  variants,
} from '@/lib/db/schema';
import { eq, desc, gte, sql, count } from 'drizzle-orm';
import { PlatformTabs } from '@/components/dashboard/ad-spend/platform-tabs';
import { SpendByVerticalChart } from '@/components/dashboard/ad-spend/spend-by-vertical-chart';
import type { SpendByVerticalRow } from '@/components/dashboard/ad-spend/spend-by-vertical-chart';
import type { UnifiedCampaign } from '@/lib/ad-platforms/unified';
import { AdManagementClient } from '@/components/dashboard/ad-management/ad-management-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Budget recommendations
// ---------------------------------------------------------------------------

interface Recommendation {
  campaign: string;
  platform: UnifiedCampaign['platform'];
  action: 'increase' | 'decrease' | 'maintain';
  message: string;
  cpa: number;
}

function buildRecommendations(campaigns: UnifiedCampaign[]): Recommendation[] {
  const withCpa = campaigns
    .filter((c) => c.platform_conversions > 0 && c.spend > 0)
    .map((c) => ({ ...c, cpa: c.spend / c.platform_conversions }));

  if (withCpa.length === 0) return [];

  const avgCpa =
    withCpa.reduce((s, c) => s + c.cpa, 0) / withCpa.length;

  return withCpa
    .filter((c) => c.cpa > avgCpa * 2 || c.cpa < avgCpa * 0.5)
    .slice(0, 5)
    .map((c) => {
      if (c.cpa > avgCpa * 2) {
        return {
          campaign: c.campaign_name || c.campaign_id,
          platform: c.platform,
          action: 'decrease' as const,
          message: `CPA is $${c.cpa.toFixed(2)} — ${((c.cpa / avgCpa - 1) * 100).toFixed(0)}% above average. Consider reducing budget.`,
          cpa: c.cpa,
        };
      }
      return {
        campaign: c.campaign_name || c.campaign_id,
        platform: c.platform,
        action: 'increase' as const,
        message: `CPA is $${c.cpa.toFixed(2)} — ${((1 - c.cpa / avgCpa) * 100).toFixed(0)}% below average. Consider scaling budget.`,
        cpa: c.cpa,
      };
    });
}

const RECOMMENDATION_STYLES: Record<Recommendation['action'], string> = {
  increase: 'border-green-500/30 bg-green-500/5',
  decrease: 'border-red-500/30 bg-red-500/5',
  maintain: 'border-amber-500/30 bg-amber-500/5',
};

const RECOMMENDATION_BADGES: Record<Recommendation['action'], string> = {
  increase: 'bg-green-500/20 text-green-400 border border-green-500/20',
  decrease: 'bg-red-500/20 text-red-400 border border-red-500/20',
  maintain: 'bg-amber-500/20 text-amber-400 border border-amber-500/20',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdManagementPage() {
  const { start, end } = getAdDateRange(30);
  const dateRange = { start, end };

  // Fetch live campaigns from ad platforms (graceful if no creds)
  const campaigns = await getAllCampaigns(dateRange);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // ---- Projects ----
  const allProjects = await db.select().from(projects).catch(() => [] as (typeof projects.$inferSelect)[]);
  const defaultProject = allProjects[0] ?? null;

  // ---- Ad Creatives with aggregated spend ----
  const allCreatives = await db
    .select()
    .from(ad_creatives)
    .catch(() => [] as (typeof ad_creatives.$inferSelect)[]);

  // Assignment counts per creative
  const assignmentCounts = await db
    .select({
      ad_creative_id: ad_assignments.ad_creative_id,
      assignment_count: count().as('assignment_count'),
    })
    .from(ad_assignments)
    .where(eq(ad_assignments.status, 'active'))
    .groupBy(ad_assignments.ad_creative_id)
    .catch(() => [] as { ad_creative_id: string; assignment_count: number }[]);

  const assignmentCountMap = new Map(
    assignmentCounts.map((r) => [r.ad_creative_id, Number(r.assignment_count)])
  );

  // Aggregated spend per creative
  const spendAgg = await db
    .select({
      ad_creative_id: ad_spend_records.ad_creative_id,
      total_spend: sql<number>`coalesce(sum(${ad_spend_records.spend}), 0)`.as('total_spend'),
      total_conversions: sql<number>`coalesce(sum(${ad_spend_records.platform_conversions}), 0)`.as('total_conversions'),
      total_clicks: sql<number>`coalesce(sum(${ad_spend_records.clicks}), 0)`.as('total_clicks'),
      total_impressions: sql<number>`coalesce(sum(${ad_spend_records.impressions}), 0)`.as('total_impressions'),
    })
    .from(ad_spend_records)
    .where(sql`${ad_spend_records.ad_creative_id} is not null`)
    .groupBy(ad_spend_records.ad_creative_id)
    .catch(() => [] as { ad_creative_id: string | null; total_spend: number; total_conversions: number; total_clicks: number; total_impressions: number }[]);

  const spendMap = new Map(
    spendAgg.map((r) => [r.ad_creative_id, r])
  );

  const creativesWithStats = allCreatives.map((c) => {
    const spend = spendMap.get(c.id);
    return {
      ...c,
      assignment_count: assignmentCountMap.get(c.id) ?? 0,
      total_spend: Number(spend?.total_spend ?? 0),
      total_conversions: Number(spend?.total_conversions ?? 0),
      total_clicks: Number(spend?.total_clicks ?? 0),
      total_impressions: Number(spend?.total_impressions ?? 0),
    };
  });

  // ---- All active assignments with joins ----
  const allAssignments = await db
    .select({
      id: ad_assignments.id,
      ad_creative_id: ad_assignments.ad_creative_id,
      vertical_id: ad_assignments.vertical_id,
      variant_id: ad_assignments.variant_id,
      status: ad_assignments.status,
      utm_content_tag: ad_assignments.utm_content_tag,
      daily_budget: ad_assignments.daily_budget,
      start_date: ad_assignments.start_date,
      end_date: ad_assignments.end_date,
      notes: ad_assignments.notes,
      created_at: ad_assignments.created_at,
      creative_name: ad_creatives.name,
      creative_platform: ad_creatives.platform,
      creative_format: ad_creatives.format,
      vertical_name: verticals.name,
      vertical_slug: verticals.slug,
      variant_slug: variants.slug,
    })
    .from(ad_assignments)
    .leftJoin(ad_creatives, eq(ad_assignments.ad_creative_id, ad_creatives.id))
    .leftJoin(verticals, eq(ad_assignments.vertical_id, verticals.id))
    .leftJoin(variants, eq(ad_assignments.variant_id, variants.id))
    .catch(() => []);

  // ---- All verticals with their variants ----
  const allVerticals = await db.select().from(verticals).catch(() => [] as (typeof verticals.$inferSelect)[]);
  const allVariants = await db.select().from(variants).catch(() => [] as (typeof variants.$inferSelect)[]);

  const verticalsWithVariants = allVerticals.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    variants: allVariants
      .filter((va) => va.vertical_id === v.id)
      .map((va) => ({ id: va.id, slug: va.slug })),
  }));

  // ---- Google Ads section data ----
  const dbSpendByPlatform = await db
    .select({
      platform: ad_spend_records.platform,
      totalSpend: sql<number>`sum(${ad_spend_records.spend})`.as('total_spend'),
    })
    .from(ad_spend_records)
    .where(gte(ad_spend_records.date, thirtyDaysAgo))
    .groupBy(ad_spend_records.platform)
    .orderBy(desc(sql`total_spend`))
    .catch(() => [] as { platform: string; totalSpend: number }[]);

  const dbSpendByVertical = await db
    .select({
      verticalId: ad_spend_records.vertical_id,
      verticalName: verticals.name,
      platform: ad_spend_records.platform,
      totalSpend: sql<number>`sum(${ad_spend_records.spend})`.as('total_spend'),
    })
    .from(ad_spend_records)
    .leftJoin(verticals, sql`${ad_spend_records.vertical_id} = ${verticals.id}`)
    .where(gte(ad_spend_records.date, thirtyDaysAgo))
    .groupBy(ad_spend_records.vertical_id, verticals.name, ad_spend_records.platform)
    .orderBy(desc(sql`total_spend`))
    .catch(() => [] as { verticalId: string | null; verticalName: string | null; platform: string; totalSpend: number }[]);

  const verticalMap = new Map<string, SpendByVerticalRow>();
  for (const row of dbSpendByVertical) {
    const key = row.verticalName ?? row.verticalId ?? 'Unknown';
    if (!verticalMap.has(key)) {
      verticalMap.set(key, { vertical: key, google: 0, other: 0 });
    }
    const entry = verticalMap.get(key)!;
    const spend = Number(row.totalSpend ?? 0);
    if (row.platform === 'google') entry.google += spend;
    else entry.other += spend;
  }
  const spendByVertical = Array.from(verticalMap.values()).slice(0, 8);

  // KPI calculations
  const totalSpend =
    campaigns.length > 0
      ? campaigns.reduce((s, c) => s + c.spend, 0)
      : dbSpendByPlatform.reduce((s, row) => s + Number(row.totalSpend ?? 0), 0);

  const totalConversions = campaigns.reduce((s, c) => s + c.platform_conversions, 0);
  const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : null;

  const activeCampaigns = campaigns.filter((c) => {
    const s = c.status.toUpperCase();
    return s === 'ACTIVE' || s === 'ENABLED';
  }).length;

  const platformCoverage = campaigns.length > 0 ? 'Google' : '—';

  const recommendations = buildRecommendations(campaigns);
  const hasCredentials = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);

  // Build campaign_id → vertical name map for the campaign table
  const campaignVerticalMap: Record<string, { vertical_name: string; vertical_slug: string }> = {};
  for (const creative of allCreatives) {
    if (creative.platform_campaign_id) {
      const assignment = allAssignments.find(
        (a) => a.ad_creative_id === creative.id && a.status === 'active'
      );
      if (assignment?.vertical_name) {
        campaignVerticalMap[creative.platform_campaign_id] = {
          vertical_name: assignment.vertical_name,
          vertical_slug: assignment.vertical_slug ?? '',
        };
      }
    }
  }

  // Serialise for client components (dates → strings)
  const serialisedAssignments = allAssignments.map((a) => ({
    id: a.id,
    ad_creative_id: a.ad_creative_id,
    creative_name: a.creative_name ?? '',
    creative_platform: a.creative_platform ?? '',
    creative_format: a.creative_format ?? '',
    vertical_name: a.vertical_name ?? '',
    vertical_slug: a.vertical_slug ?? '',
    variant_slug: a.variant_slug ?? null,
    status: a.status,
    utm_content_tag: a.utm_content_tag,
    daily_budget: a.daily_budget ?? null,
  }));

  const serialisedCreatives = creativesWithStats.map((c) => ({
    id: c.id,
    project_id: c.project_id,
    name: c.name,
    platform: c.platform,
    format: c.format,
    version: c.version,
    status: c.status,
    copy_headline: c.copy_headline,
    copy_body: c.copy_body,
    copy_cta: c.copy_cta,
    assignment_count: c.assignment_count,
    total_spend: c.total_spend,
    total_conversions: c.total_conversions,
  }));

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Ad Management</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Ad creatives, assignments, and campaign performance
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Sections A + B (client-interactive)                                */}
      {/* ------------------------------------------------------------------ */}
      <AdManagementClient
        creatives={serialisedCreatives}
        assignments={serialisedAssignments}
        verticals={verticalsWithVariants}
        projects={allProjects.map((p) => ({ id: p.id, name: p.name }))}
        defaultProjectId={defaultProject?.id ?? ''}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Section C: Campaign Performance (Google Ads)                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Campaign Performance</h2>
          <p className="text-zinc-500 text-xs mt-0.5">Google Ads — last 30 days</p>
        </div>

        {/* Empty state when no platform credentials */}
        {!hasCredentials && (
          <div className="border border-white/10 rounded-xl bg-zinc-900 p-8 text-center">
            <p className="text-lg font-semibold mb-2">Connect Google Ads to track spend</p>
            <p className="text-zinc-500 text-sm mb-6">
              Set the following environment variables to start syncing campaign data:
            </p>
            <div className="max-w-sm mx-auto text-left">
              <div className="bg-zinc-800 rounded-lg p-4">
                <p className="text-red-400 font-medium mb-2 text-sm">Google Ads</p>
                <code className="text-xs text-zinc-400 block">GOOGLE_ADS_DEVELOPER_TOKEN</code>
                <code className="text-xs text-zinc-400 block">GOOGLE_ADS_CLIENT_ID</code>
                <code className="text-xs text-zinc-400 block">GOOGLE_ADS_CLIENT_SECRET</code>
                <code className="text-xs text-zinc-400 block">GOOGLE_ADS_REFRESH_TOKEN</code>
                <code className="text-xs text-zinc-400 block">GOOGLE_ADS_CUSTOMER_ID</code>
              </div>
            </div>
          </div>
        )}

        {/* KPI Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'Total Spend (30d)',
              value: fmt$(totalSpend),
              sub: 'Google Ads',
              accent: 'text-white',
            },
            {
              label: 'Average CPA',
              value: avgCpa !== null ? fmt$(avgCpa) : '—',
              sub: 'spend / conversions',
              accent: 'text-amber-400',
            },
            {
              label: 'Active Campaigns',
              value: String(activeCampaigns || campaigns.length),
              sub: 'running right now',
              accent: 'text-green-400',
            },
            {
              label: 'Platform Coverage',
              value: platformCoverage,
              sub: 'connected platform',
              accent: 'text-red-400',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="border border-white/10 rounded-xl bg-zinc-900 p-4"
            >
              <p className="text-zinc-500 text-xs mb-2">{card.label}</p>
              <p className={`text-2xl font-bold truncate ${card.accent}`}>{card.value}</p>
              <p className="text-zinc-600 text-xs mt-1">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Campaign Performance Table */}
        <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
          <h3 className="font-semibold mb-4">Campaigns</h3>
          <PlatformTabs campaigns={campaigns} campaignVerticalMap={campaignVerticalMap} />
        </div>

        {/* Spend by Vertical */}
        <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
          <h3 className="font-semibold mb-4">Spend by Vertical (30d)</h3>
          <SpendByVerticalChart data={spendByVertical} />
        </div>

        {/* Budget Recommendations */}
        <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
          <h3 className="font-semibold mb-4">Budget Recommendations</h3>
          {recommendations.length === 0 ? (
            <p className="text-zinc-600 text-sm">
              {campaigns.length === 0
                ? 'Connect Google Ads to see recommendations'
                : 'All campaigns are performing near average CPA — no adjustments needed.'}
            </p>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className={`border rounded-xl p-4 ${RECOMMENDATION_STYLES[rec.action]}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 ${RECOMMENDATION_BADGES[rec.action]}`}
                    >
                      {rec.action === 'increase'
                        ? 'Scale'
                        : rec.action === 'decrease'
                        ? 'Reduce'
                        : 'Maintain'}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{rec.campaign}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{rec.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
