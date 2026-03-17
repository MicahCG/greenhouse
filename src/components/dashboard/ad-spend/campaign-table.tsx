'use client';

import { useState } from 'react';
import type { UnifiedCampaign } from '@/lib/ad-platforms/unified';

type SortKey = keyof Pick<UnifiedCampaign, 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'platform_conversions'>;

function PlatformBadge({ platform }: { platform: UnifiedCampaign['platform'] }) {
  const styles: Record<UnifiedCampaign['platform'], string> = {
    google: 'bg-red-500/20 text-red-400',
  };
  const labels: Record<UnifiedCampaign['platform'], string> = {
    google: 'Google',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[platform]}`}>
      {labels[platform]}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const isActive = s === 'ACTIVE' || s === 'ENABLED';
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        isActive ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-500'
      }`}
    >
      {isActive ? 'Active' : status}
    </span>
  );
}

interface Props {
  campaigns: UnifiedCampaign[];
  filterPlatform: 'all' | UnifiedCampaign['platform'];
  campaignVerticalMap?: Record<string, { vertical_name: string; vertical_slug: string }>;
}

export function CampaignTable({ campaigns, filterPlatform, campaignVerticalMap = {} }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered =
    filterPlatform === 'all'
      ? campaigns
      : campaigns.filter((c) => c.platform === filterPlatform);

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortHeader({ label, sortK }: { label: string; sortK: SortKey }) {
    const active = sortKey === sortK;
    return (
      <button
        onClick={() => handleSort(sortK)}
        className={`flex items-center gap-1 hover:text-white transition-colors ${
          active ? 'text-white' : 'text-zinc-500'
        }`}
      >
        {label}
        <span className="text-xs opacity-60">
          {active ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
        </span>
      </button>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-600">
        <p className="text-sm mb-1">No campaigns connected</p>
        <p className="text-xs text-zinc-700">
          Google Ads — set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Campaign</th>
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Vertical</th>
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Platform</th>
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Status</th>
            <th className="text-right py-2 px-3 font-medium">
              <SortHeader label="Spend" sortK="spend" />
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <SortHeader label="Impressions" sortK="impressions" />
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <SortHeader label="Clicks" sortK="clicks" />
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <SortHeader label="CTR" sortK="ctr" />
            </th>
            <th className="text-right py-2 px-3 font-medium">
              <SortHeader label="Platform Conv." sortK="platform_conversions" />
            </th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">CPA (est.)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const cpa =
              c.platform_conversions > 0
                ? (c.spend / c.platform_conversions).toFixed(2)
                : '—';
            const verticalMatch = campaignVerticalMap[c.campaign_id];
            return (
              <tr
                key={`${c.platform}-${c.campaign_id}`}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-3 px-3 text-white max-w-[200px] truncate">
                  {c.campaign_name || c.campaign_id}
                </td>
                <td className="py-3 px-3">
                  {verticalMatch ? (
                    <div>
                      <p className="text-zinc-200 text-xs font-medium">{verticalMatch.vertical_name}</p>
                      <p className="text-zinc-600 text-xs">/{verticalMatch.vertical_slug}</p>
                    </div>
                  ) : (
                    <span className="text-zinc-700 text-xs">—</span>
                  )}
                </td>
                <td className="py-3 px-3">
                  <PlatformBadge platform={c.platform} />
                </td>
                <td className="py-3 px-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="py-3 px-3 text-right text-white">
                  ${c.spend.toFixed(2)}
                </td>
                <td className="py-3 px-3 text-right text-zinc-400">
                  {c.impressions.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right text-zinc-400">
                  {c.clicks.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right text-zinc-400">
                  {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : '—'}
                </td>
                <td className="py-3 px-3 text-right text-zinc-400">
                  {c.platform_conversions.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right text-zinc-400">
                  {cpa !== '—' ? `$${cpa}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
