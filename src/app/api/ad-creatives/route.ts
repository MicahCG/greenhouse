import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ad_creatives, ad_assignments, ad_spend_records } from '@/lib/db/schema';
import { eq, sql, count } from 'drizzle-orm';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return Response.json({ error: 'projectId is required' }, { status: 400 });
  }

  // Fetch all creatives for project
  const creatives = await db
    .select()
    .from(ad_creatives)
    .where(eq(ad_creatives.project_id, projectId));

  if (creatives.length === 0) {
    return Response.json([]);
  }

  // Get assignment counts per creative
  const assignmentCounts = await db
    .select({
      ad_creative_id: ad_assignments.ad_creative_id,
      assignment_count: count().as('assignment_count'),
    })
    .from(ad_assignments)
    .groupBy(ad_assignments.ad_creative_id);

  const assignmentCountMap = new Map(
    assignmentCounts.map((r) => [r.ad_creative_id, Number(r.assignment_count)])
  );

  // Aggregate spend from ad_spend_records grouped by ad_creative_id
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
    .groupBy(ad_spend_records.ad_creative_id);

  const spendMap = new Map(
    spendAgg.map((r) => [r.ad_creative_id, r])
  );

  const result = creatives.map((c) => {
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

  return Response.json(result);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    project_id,
    name,
    platform,
    format,
    copy_headline,
    copy_body,
    copy_cta,
    media_url,
    thumbnail_url,
    platform_campaign_id,
    platform_ad_id,
    notes,
  } = body as Record<string, string | undefined>;

  if (!project_id || !name || !platform || !format) {
    return Response.json(
      { error: 'project_id, name, platform, and format are required' },
      { status: 400 }
    );
  }

  const [creative] = await db
    .insert(ad_creatives)
    .values({
      project_id,
      name,
      platform,
      format,
      copy_headline: copy_headline ?? null,
      copy_body: copy_body ?? null,
      copy_cta: copy_cta ?? null,
      media_url: media_url ?? null,
      thumbnail_url: thumbnail_url ?? null,
      platform_campaign_id: platform_campaign_id ?? null,
      platform_ad_id: platform_ad_id ?? null,
      notes: notes ?? null,
    })
    .returning();

  return Response.json(creative, { status: 201 });
}
