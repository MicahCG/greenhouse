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

interface DataRow {
  source: string;
  visitors: number;
  pct: number;
}

interface Props {
  data: DataRow[];
}

const SOURCE_COLORS: Record<string, string> = {
  organic: '#10b981',
  direct: '#3b82f6',
  seo: '#10b981',
  paid: '#f59e0b',
  meta: '#f59e0b',
  google: '#ef4444',
  tiktok: '#a78bfa',
  twitter: '#38bdf8',
  email: '#fb923c',
  referral: '#34d399',
};

function colorForSource(source: string): string {
  return SOURCE_COLORS[source.toLowerCase()] ?? '#71717a';
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DataRow }>;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white font-medium capitalize mb-1">{row.source}</p>
      <p className="text-zinc-400">{row.visitors.toLocaleString()} visitors</p>
      <p className="text-zinc-400">{row.pct}% of total</p>
    </div>
  );
};

export function TrafficSourceChart({ data }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm border border-white/5 rounded-lg bg-zinc-800/30">
        No traffic source data available yet
      </div>
    );
  }

  // Sort descending
  const sorted = [...data].sort((a, b) => b.visitors - a.visitors);

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, sorted.length * 40 + 40)}>
      <BarChart
        data={sorted}
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
        />
        <YAxis
          type="category"
          dataKey="source"
          tick={{ fill: '#a1a1aa', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={80}
          tickFormatter={(v: string) =>
            v.charAt(0).toUpperCase() + v.slice(1)
          }
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Bar dataKey="visitors" radius={[0, 4, 4, 0]} maxBarSize={24}>
          {sorted.map((row, i) => (
            <Cell key={i} fill={colorForSource(row.source)} opacity={0.85} />
          ))}
          <LabelList
            dataKey="pct"
            position="right"
            style={{ fill: '#a1a1aa', fontSize: 11 }}
            formatter={(v: unknown) => typeof v === 'number' ? `${v}%` : String(v ?? '')}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
