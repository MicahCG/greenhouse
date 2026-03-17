export const dynamic = 'force-dynamic';

import { getTrafficOverview, getGrowthMetrics } from '@/lib/dashboard/queries';
import { AnalyticsCharts } from './analytics-charts';

export default async function AnalyticsPage() {
  const [overview, growth] = await Promise.all([
    getTrafficOverview(30),
    getGrowthMetrics(30),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-zinc-500 text-sm mt-1">
          30-day growth metrics — visitors, registrations, and purchases
        </p>
      </div>

      <AnalyticsCharts
        visitors={growth.visitors}
        registrations={growth.registrations}
        purchases={growth.purchases}
        visitorsDaily={growth.visitorsDaily}
        registrationsDaily={growth.registrationsDaily}
        purchasesDaily={growth.purchasesDaily}
        visitorsTotal={growth.visitorsTotal}
        registrationsTotal={growth.registrationsTotal}
        purchasesTotal={growth.purchasesTotal}
        bySource={overview.bySource}
        byDevice={overview.byDevice}
        organicPct={overview.organicPct}
        paidPct={overview.paidPct}
      />
    </div>
  );
}
