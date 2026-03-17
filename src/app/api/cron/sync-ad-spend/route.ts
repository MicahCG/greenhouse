import { getAllCampaigns, formatDate } from '@/lib/ad-platforms/unified';
import { db } from '@/lib/db';
import { ad_spend_records, projects } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(request: Request) {
  // Auth check
  const secret = request.headers.get('x-cron-secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch yesterday's data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = formatDate(yesterday);
    const dateRange = { start: dateStr, end: dateStr };

    const campaigns = await getAllCampaigns(dateRange);

    if (campaigns.length === 0) {
      return Response.json({ processed: 0, message: 'No campaigns returned from any platform' });
    }

    // Fetch first project as fallback for attribution
    const allProjects = await db.select({ id: projects.id }).from(projects).limit(1);
    const fallbackProjectId = allProjects[0]?.id;

    if (!fallbackProjectId) {
      return Response.json({ processed: 0, message: 'No projects found to associate spend records with' });
    }

    let inserted = 0;
    for (const campaign of campaigns) {
      try {
        await db.insert(ad_spend_records).values({
          project_id: fallbackProjectId,
          platform: campaign.platform,
          campaign_id: campaign.campaign_id,
          campaign_name: campaign.campaign_name,
          spend: campaign.spend,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          cpc: campaign.cpc,
          ctr: campaign.ctr,
          platform_conversions: campaign.platform_conversions,
          date: yesterday,
        });
        inserted++;
      } catch (err) {
        console.warn('[sync-ad-spend] Failed to insert record for campaign', campaign.campaign_id, err);
      }
    }

    return Response.json({
      processed: campaigns.length,
      inserted,
      date: dateStr,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync-ad-spend] Error:', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
