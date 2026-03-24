'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const TrafficSourceChart = dynamic(
  () => import('@/components/dashboard/traffic-source-chart').then((m) => m.TrafficSourceChart),
  { ssr: false }
);

const TrendAreaChart = dynamic(
  () => import('./trend-area-chart').then((m) => m.TrendAreaChart),
  { ssr: false }
);

interface SeriesPoint { date: string; value: number }
interface SourceRow { source: string; visitors: number; pct: number }
interface DeviceRow { device: string; visitors: number; pct: number }

interface KpiMetric {
  daily: SeriesPoint[];
  total: number;
  prevTotal: number;
  avg: number;
  prevAvg: number;
  momChange: number;
}

interface Props {
  visitors: KpiMetric;
  registrations: KpiMetric;
  purchases: KpiMetric;
  // Legacy flat fields
  visitorsDaily: SeriesPoint[];
  registrationsDaily: SeriesPoint[];
  purchasesDaily: SeriesPoint[];
  visitorsTotal: number;
  registrationsTotal: number;
  purchasesTotal: number;
  // Traffic details
  bySource: SourceRow[];
  byDevice: DeviceRow[];
  organicPct: number;
  paidPct: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

interface MetricCardProps {
  title: string;
  subtitle: string;
  kpi: KpiMetric;
  label: string;
  color: string;
  gradientId: string;
}

function MetricCard({ title, subtitle, kpi, label, color, gradientId }: MetricCardProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const up = kpi.momChange >= 0;

  return (
    <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs text-zinc-500">{subtitle}</p>
          <p className="font-semibold text-sm mt-0.5">{title}</p>
        </div>
        <p className="text-2xl font-bold" style={{ color }}>{formatNumber(kpi.total)}</p>
      </div>
      <p className="text-xs text-zinc-600 mb-4">last 30 days</p>
      <TrendAreaChart
        series={kpi.daily}
        label={label}
        color={color}
        gradientId={gradientId}
      />

      {/* More toggle */}
      <button
        onClick={() => setMoreOpen((o) => !o)}
        className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span className={`text-[10px] transition-transform ${moreOpen ? 'rotate-90' : ''}`}>▶</span>
        More
      </button>

      {moreOpen && (
        <div className="mt-3 border-t border-white/5 pt-3 space-y-2">
          {/* MoM change */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Month-over-month</span>
            <span className={`text-xs font-semibold ${up ? 'text-green-400' : 'text-red-400'}`}>
              {formatPct(kpi.momChange)}
            </span>
          </div>
          {/* Previous period total */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Previous 30 days</span>
            <span className="text-xs text-zinc-300 font-medium">{formatNumber(kpi.prevTotal)}</span>
          </div>
          {/* Delta */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Change</span>
            <span className={`text-xs font-medium ${up ? 'text-green-400' : 'text-red-400'}`}>
              {up ? '+' : ''}{formatNumber(kpi.total - kpi.prevTotal)}
            </span>
          </div>
          {/* Daily average comparison */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Daily avg (current)</span>
            <span className="text-xs text-zinc-300 font-medium">{kpi.avg.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Daily avg (previous)</span>
            <span className="text-xs text-zinc-400">{kpi.prevAvg.toFixed(1)}</span>
          </div>
          {kpi.prevAvg > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Avg change</span>
              <span className={`text-xs font-semibold ${kpi.avg >= kpi.prevAvg ? 'text-green-400' : 'text-red-400'}`}>
                {formatPct(((kpi.avg - kpi.prevAvg) / kpi.prevAvg) * 100)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AnalyticsCharts({
  visitors,
  registrations,
  purchases,
  bySource,
  byDevice,
  organicPct,
  paidPct,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const ORGANIC_SOURCES_SET = new Set(['organic', 'direct', 'seo', 'referral']);
  let topOrganicSource = '';
  let topPaidSource = '';
  let organicVisitors = 0;
  let paidVisitors = 0;
  for (const row of bySource) {
    if (ORGANIC_SOURCES_SET.has(row.source.toLowerCase())) {
      organicVisitors += row.visitors;
      if (!topOrganicSource) topOrganicSource = row.source;
    } else {
      paidVisitors += row.visitors;
      if (!topPaidSource) topPaidSource = row.source;
    }
  }
  const totalSource = organicVisitors + paidVisitors;

  return (
    <div className="space-y-6">
      {/* 3 primary KPI charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Page View"
          subtitle="Unique visitors"
          kpi={visitors}
          label="visitors"
          color="#f59e0b"
          gradientId="visitorsGrad"
        />
        <MetricCard
          title="New Registrations"
          subtitle="Registered users"
          kpi={registrations}
          label="registrations"
          color="#22c55e"
          gradientId="regsGrad"
        />
        <MetricCard
          title="Credit Purchases"
          subtitle="Credit package purchases"
          kpi={purchases}
          label="purchases"
          color="#3b82f6"
          gradientId="purchasesGrad"
        />
      </div>

      {/* Traffic details toggle */}
      <div>
        <button
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors px-1"
        >
          <span className={`text-xs transition-transform ${detailsOpen ? 'rotate-90' : ''}`}>▶</span>
          Traffic Details
        </button>

        {detailsOpen && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
                <h2 className="font-semibold mb-4 text-sm">Traffic by Source</h2>
                <TrafficSourceChart data={bySource} />
              </div>

              <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
                <h2 className="font-semibold mb-4 text-sm">Device Breakdown</h2>
                {byDevice.length === 0 ? (
                  <p className="text-zinc-600 text-sm">No device data available yet</p>
                ) : (
                  <div className="space-y-3">
                    {byDevice.map((row) => (
                      <div key={row.device} className="flex items-center gap-3">
                        <span className="text-sm text-zinc-400 w-20 capitalize">{row.device}</span>
                        <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${row.pct}%` }} />
                        </div>
                        <span className="text-sm text-zinc-400 w-10 text-right">{row.pct}%</span>
                        <span className="text-xs text-zinc-600 w-20 text-right">{row.visitors.toLocaleString()} vis.</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
              <h2 className="font-semibold mb-1 text-sm">Organic vs Paid</h2>
              <p className="text-zinc-500 text-xs mb-4">30-day comparison across traffic channels</p>
              {bySource.length === 0 ? (
                <p className="text-zinc-600 text-sm">No traffic source data available yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-2 px-3 text-zinc-500 font-medium">Metric</th>
                        <th className="text-center py-2 px-3 font-medium text-green-400">Organic</th>
                        <th className="text-center py-2 px-3 font-medium text-amber-400">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { metric: 'Visitors', organic: organicVisitors.toLocaleString(), paid: paidVisitors.toLocaleString() },
                        {
                          metric: 'Share',
                          organic: `${totalSource > 0 ? Math.round((organicVisitors / totalSource) * 100) : organicPct}%`,
                          paid: `${totalSource > 0 ? Math.round((paidVisitors / totalSource) * 100) : paidPct}%`,
                        },
                        { metric: 'Top Source', organic: topOrganicSource ? topOrganicSource.charAt(0).toUpperCase() + topOrganicSource.slice(1) : '—', paid: topPaidSource ? topPaidSource.charAt(0).toUpperCase() + topPaidSource.slice(1) : '—' },
                      ].map((row) => (
                        <tr key={row.metric} className="border-b border-white/5">
                          <td className="py-3 px-3 text-zinc-400">{row.metric}</td>
                          <td className="py-3 px-3 text-center text-white font-medium">{row.organic}</td>
                          <td className="py-3 px-3 text-center text-white font-medium">{row.paid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
