'use client';

import { CampaignTable } from './campaign-table';
import type { UnifiedCampaign } from '@/lib/ad-platforms/unified';

interface Props {
  campaigns: UnifiedCampaign[];
  campaignVerticalMap?: Record<string, { vertical_name: string; vertical_slug: string }>;
}

export function PlatformTabs({ campaigns, campaignVerticalMap }: Props) {
  return (
    <div>
      <CampaignTable campaigns={campaigns} filterPlatform="all" campaignVerticalMap={campaignVerticalMap ?? {}} />
    </div>
  );
}
