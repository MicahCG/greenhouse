'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface DataPoint {
  date: string;
  visitors: number;
  clicks: number;
  convRate: number;
}

interface Props {
  series: DataPoint[];
}

function formatDate(dateStr: string): string {
  // Amplitude returns YYYY-MM-DD
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-2">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}:{' '}
          {entry.name === 'Conv. Rate'
            ? formatPct(entry.value)
            : entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export function VariantPerformanceChart({ series }: Props) {
  if (!series || series.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm border border-white/5 rounded-lg bg-zinc-800/30">
        No performance data available yet
      </div>
    );
  }

  const chartData = series.map((p) => ({
    ...p,
    date: formatDate(p.date),
    convRatePct: p.convRate, // keep as decimal; tooltip formats it
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart
        data={chartData}
        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          tickLine={false}
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
        />
        <Bar
          yAxisId="left"
          dataKey="visitors"
          name="Visitors"
          fill="#3b82f6"
          radius={[2, 2, 0, 0]}
          opacity={0.8}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="convRatePct"
          name="Conv. Rate"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#f59e0b' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
