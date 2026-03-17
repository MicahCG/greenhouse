export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { agent_changes } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { AgentLogClient } from './agent-log-client';

export default async function AgentLogPage() {
  const changes = await db
    .select({
      id: agent_changes.id,
      hypothesis: agent_changes.hypothesis,
      description: agent_changes.description,
      change_type: agent_changes.change_type,
      verdict: agent_changes.verdict,
      confidence_level: agent_changes.confidence_level,
      samples_collected: agent_changes.samples_collected,
      min_sample_size: agent_changes.min_sample_size,
      implemented_at: agent_changes.implemented_at,
      evaluated_at: agent_changes.evaluated_at,
      diff_summary: agent_changes.diff_summary,
      variant_id: agent_changes.variant_id,
    })
    .from(agent_changes)
    .orderBy(desc(agent_changes.implemented_at))
    .limit(50);

  // Aggregate stats
  const total = changes.length;
  const wins = changes.filter((c) => c.verdict === 'win').length;
  const pending = changes.filter((c) => c.verdict === 'pending' || c.verdict === 'need_more_data').length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Agent Log</h1>
        <p className="text-zinc-500 text-sm mt-1">All AI-driven experiment changes and their outcomes</p>
      </div>

      {/* Aggregate stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-zinc-900 border border-white/10 rounded-xl p-4">
          <p className="text-zinc-500 text-xs mb-1">Total Changes</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-zinc-900 border border-white/10 rounded-xl p-4">
          <p className="text-zinc-500 text-xs mb-1">Win Rate</p>
          <p className="text-2xl font-bold text-green-400">{winRate}%</p>
        </div>
        <div className="bg-zinc-900 border border-white/10 rounded-xl p-4">
          <p className="text-zinc-500 text-xs mb-1">Pending Evaluation</p>
          <p className="text-2xl font-bold text-amber-400">{pending}</p>
        </div>
      </div>

      <AgentLogClient changes={changes} />
    </div>
  );
}
