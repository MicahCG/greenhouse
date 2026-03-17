'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  date: string;
  value: number;
}

interface Props {
  series: DataPoint[];
  label?: string;
  color?: string;
  gradientId?: string;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

const CustomTooltip = ({
  active,
  payload,
  label,
  metricLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  metricLabel: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p className="font-medium" style={{ color: 'inherit' }}>
        {payload[0].value.toLocaleString()} {metricLabel}
      </p>
    </div>
  );
};

export function TrendAreaChart({
  series,
  label = 'visitors',
  color = '#f59e0b',
  gradientId = 'metricGradient',
}: Props) {
  if (!series || series.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm border border-white/5 rounded-lg bg-zinc-800/30">
        No data yet
      </div>
    );
  }

  const chartData = series.map((p) => ({
    ...p,
    date: formatDate(p.date),
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip metricLabel={label} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
