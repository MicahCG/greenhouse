'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

interface FunnelStep {
  event: string;
  label?: string;
  count: number;
  conversionRate: number;
  dropOff?: number;
}

interface Props {
  steps: FunnelStep[];
}

const EVENT_LABELS: Record<string, string> = {
  lp_page_viewed: 'Page Views',
  lp_cta_clicked: 'CTA Clicks',
  registration_started: 'Reg. Started',
  registration_completed: 'Reg. Completed',
};

function prettifyEvent(event: string, label?: string): string {
  return label ?? EVENT_LABELS[event] ?? event;
}

const STEP_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#a78bfa'];

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: FunnelStep & { prettyLabel: string } }>;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const step = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white font-medium mb-1">{step.prettyLabel}</p>
      <p className="text-zinc-400">{step.count.toLocaleString()} users</p>
      {step.dropOff !== undefined && step.dropOff > 0 && (
        <p className="text-red-400 mt-1">−{step.dropOff}% drop-off</p>
      )}
    </div>
  );
};

export function FunnelChart({ steps }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm border border-white/5 rounded-lg bg-zinc-800/30">
        No funnel data available yet
      </div>
    );
  }

  const chartData = steps.map((s) => ({
    ...s,
    prettyLabel: prettifyEvent(s.event, s.label),
  }));

  const maxCount = Math.max(...chartData.map((s) => s.count), 1);

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 60, bottom: 4, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            type="number"
            tick={{ fill: '#71717a', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={[0, maxCount]}
          />
          <YAxis
            type="category"
            dataKey="prettyLabel"
            tick={{ fill: '#a1a1aa', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {chartData.map((_, index) => (
              <Cell
                key={index}
                fill={STEP_COLORS[index % STEP_COLORS.length]}
                opacity={0.85}
              />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              style={{ fill: '#a1a1aa', fontSize: 11 }}
              formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v ?? '')}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Drop-off indicators */}
      <div className="flex gap-4 flex-wrap mt-2">
        {chartData.map((step, i) => (
          i > 0 && step.dropOff !== undefined && step.dropOff > 0 ? (
            <span key={step.event} className="text-xs text-zinc-500">
              {chartData[i - 1].prettyLabel} → {step.prettyLabel}:{' '}
              <span className="text-red-400">−{step.dropOff}%</span>
            </span>
          ) : null
        ))}
      </div>
    </div>
  );
}
