'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const VariantPerformanceChart = dynamic(
  () => import('@/components/dashboard/variant-performance-chart').then((m) => m.VariantPerformanceChart),
  { ssr: false }
);

const TrafficSourceChart = dynamic(
  () => import('@/components/dashboard/traffic-source-chart').then((m) => m.TrafficSourceChart),
  { ssr: false }
);

interface DataPoint { date: string; visitors: number; clicks: number; convRate: number }
interface SourceRow { source: string; visitors: number; pct: number }

export function VariantCharts({
  series: initialSeries,
  trafficSources,
  variantId,
}: {
  series: DataPoint[];
  trafficSources: SourceRow[];
  variantId: string;
}) {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState(initialSeries);
  const [loading, setLoading] = useState(false);

  // Fetch new data when days changes
  useEffect(() => {
    if (days === 30) {
      setSeries(initialSeries);
      return;
    }
    setLoading(true);
    fetch(`/api/analytics/variant/${variantId}/series?windowDays=${days}`)
      .then((r) => r.json())
      .then((data: { data?: { timeSeries?: DataPoint[] } }) => {
        if (data.data?.timeSeries) setSeries(data.data.timeSeries);
      })
      .catch(() => { /* keep current */ })
      .finally(() => setLoading(false));
  }, [days, variantId, initialSeries]);

  // Compute totals
  const totalVisitors = series.reduce((s, p) => s + p.visitors, 0);
  const totalConversions = series.reduce((s, p) => s + p.clicks, 0);
  const avgConvRate = totalVisitors > 0 ? totalConversions / totalVisitors : 0;

  return (
    <>
      <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Performance Over Time</h2>
          <div className="flex items-center gap-1">
            {[7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  days === d
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Event totals */}
        <div className="flex items-center gap-6 mb-4 text-xs">
          <div>
            <span className="text-zinc-500">Visitors</span>
            <span className="text-white font-semibold ml-2">{totalVisitors.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-zinc-500">Conversions</span>
            <span className="text-white font-semibold ml-2">{totalConversions.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-zinc-500">Conv. Rate</span>
            <span className={`font-semibold ml-2 ${avgConvRate > 0 ? 'text-green-400' : 'text-zinc-400'}`}>
              {(avgConvRate * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {loading ? (
          <div className="h-48 flex items-center justify-center text-xs text-zinc-600 animate-pulse">Loading...</div>
        ) : (
          <VariantPerformanceChart series={series} />
        )}
      </div>
      <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
        <h2 className="font-semibold mb-4">Traffic Source Breakdown</h2>
        <TrafficSourceChart data={trafficSources} />
      </div>
    </>
  );
}
