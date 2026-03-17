'use client';

import dynamic from 'next/dynamic';

const FunnelChart = dynamic(
  () => import('@/components/dashboard/funnel-chart').then((m) => m.FunnelChart),
  { ssr: false }
);

interface FunnelStep { event: string; count: number; conversionRate: number }

export function ProjectFunnelChart({ steps }: { steps: FunnelStep[] }) {
  return <FunnelChart steps={steps} />;
}
