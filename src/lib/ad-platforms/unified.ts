/**
 * Unified ad platform client — aggregates Google campaigns.
 */

import { getGoogleCampaigns } from './google';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedCampaign {
  platform: 'google';
  campaign_id: string;
  campaign_name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  platform_conversions: number;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYYMMDD */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Format a Date as YYYY-MM-DD for Google */
function formatDateGoogle(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns dates in both formats needed.
 * `start`/`end` = YYYYMMDD
 * `startGoogle`/`endGoogle` = YYYY-MM-DD for Google
 */
export function getAdDateRange(windowDays: number): {
  start: string;
  end: string;
  startGoogle: string;
  endGoogle: string;
} {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (windowDays - 1));
  return {
    start: formatDate(start),
    end: formatDate(end),
    startGoogle: formatDateGoogle(start),
    endGoogle: formatDateGoogle(end),
  };
}

// ---------------------------------------------------------------------------
// getAllCampaigns
// ---------------------------------------------------------------------------

export async function getAllCampaigns(
  dateRange: { start: string; end: string }
): Promise<UnifiedCampaign[]> {
  // Google expects YYYY-MM-DD; convert from YYYYMMDD if needed
  const googleDateRange = {
    start: dateRange.start.includes('-')
      ? dateRange.start
      : dateRange.start.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    end: dateRange.end.includes('-')
      ? dateRange.end
      : dateRange.end.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
  };

  const googleCampaigns = await getGoogleCampaigns(googleDateRange);

  const unified: UnifiedCampaign[] = [
    ...googleCampaigns.map(
      (c): UnifiedCampaign => ({
        platform: 'google',
        campaign_id: c.id,
        campaign_name: c.name,
        status: c.status,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: c.ctr,
        cpc: c.cpc,
        platform_conversions: c.conversions,
      })
    ),
  ];

  // Sort by spend descending
  return unified.sort((a, b) => b.spend - a.spend);
}
