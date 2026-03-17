'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface SpendByVerticalRow {
  vertical: string;
  google: number;
  other: number;
}

interface Props {
  data: SpendByVerticalRow[];
}

const PLATFORM_COLORS: Record<string, string> = {
  google: '#ef4444',
  other: '#d97706',
};

export function SpendByVerticalChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-600 text-sm">
        No spend data recorded yet
      </div>
    );
  }

  // Determine which platforms have any spend
  const platforms = (['google', 'other'] as const).filter((p) =>
    data.some((row) => row[p] > 0)
  );

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="vertical"
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v}`}
        />
        <Tooltip
          contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#fff', fontWeight: 600 }}
          itemStyle={{ color: '#a1a1aa' }}
          formatter={(value) => {
            const n = typeof value === 'number' ? value : Number(value ?? 0);
            return [`$${n.toFixed(2)}`, undefined];
          }}
        />
        <Legend wrapperStyle={{ color: '#71717a', fontSize: 12 }} />
        {platforms.map((platform) => (
          <Bar
            key={platform}
            dataKey={platform}
            name={platform.charAt(0).toUpperCase() + platform.slice(1)}
            stackId="a"
            fill={PLATFORM_COLORS[platform]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
