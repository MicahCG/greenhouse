'use client';

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
  series,
  trafficSources,
}: {
  series: DataPoint[];
  trafficSources: SourceRow[];
}) {
  return (
    <>
      <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
        <h2 className="font-semibold mb-4">Performance Over Time</h2>
        <VariantPerformanceChart series={series} />
      </div>
      <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
        <h2 className="font-semibold mb-4">Traffic Source Breakdown</h2>
        <TrafficSourceChart data={trafficSources} />
      </div>
    </>
  );
}
