import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { agent_changes, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { id } = await params;

  // Fetch the agent_change
  const [change] = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.id, id))
    .limit(1);

  if (!change) {
    return new Response(JSON.stringify({ error: 'Change not found' }), { status: 404 });
  }

  if (change.verdict !== 'proposed') {
    return new Response(
      JSON.stringify({ error: `Change is not in "proposed" state (current: ${change.verdict})` }),
      { status: 400 }
    );
  }

  // Parse proposed changes from diff_summary
  let proposedChanges: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(change.diff_summary ?? '{}') as {
      proposed_changes?: Record<string, unknown>;
    };
    proposedChanges = parsed.proposed_changes ?? {};
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to parse diff_summary' }),
      { status: 500 }
    );
  }

  // Fetch current variant
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.id, change.variant_id))
    .limit(1);

  if (!variant) {
    return new Response(JSON.stringify({ error: 'Variant not found' }), { status: 404 });
  }

  // Deep merge changes into config
  const currentConfig = (variant.config ?? {}) as Record<string, unknown>;
  const newConfig = deepMergeConfig(currentConfig, proposedChanges);

  // Update variant config and increment version
  await db
    .update(variants)
    .set({
      config: newConfig,
      version: variant.version + 1,
      updated_at: new Date(),
    })
    .where(eq(variants.id, variant.id));

  // Update agent_change verdict to 'pending' (live, awaiting evaluation)
  await db
    .update(agent_changes)
    .set({
      verdict: 'pending',
      implemented_at: new Date(),
    })
    .where(eq(agent_changes.id, id));

  return Response.json({
    success: true,
    updated_config: newConfig,
    new_version: variant.version + 1,
  });
}

/**
 * Deep merge for variant config, handling dot-notation keys like "cta_primary.text".
 */
function deepMergeConfig(
  base: Record<string, unknown>,
  changes: Record<string, unknown>
): Record<string, unknown> {
  const result = structuredClone(base) as Record<string, unknown>;

  for (const [key, value] of Object.entries(changes)) {
    if (key.includes('.')) {
      const [parent, child] = key.split('.') as [string, string];
      if (result[parent] && typeof result[parent] === 'object') {
        result[parent] = {
          ...(result[parent] as Record<string, unknown>),
          [child]: value,
        };
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
