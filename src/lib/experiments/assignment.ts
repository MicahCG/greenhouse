/**
 * Deterministic variant assignment using a hash of (userId + verticalId).
 * Respects traffic_weight proportions. The same (userId, verticalId) pair
 * always returns the same variant, so assignments are stable without DB state.
 */
export function pickVariantDeterministic(
  userId: string,
  verticalId: string,
  activeVariants: Array<{ id: string; slug: string; traffic_weight: number }>
): { id: string; slug: string; traffic_weight: number } {
  if (activeVariants.length === 0) {
    throw new Error('No active variants to assign');
  }
  if (activeVariants.length === 1) return activeVariants[0];

  // Sort deterministically by id to ensure stable ordering across calls
  const sorted = [...activeVariants].sort((a, b) => a.id.localeCompare(b.id));

  const totalWeight = sorted.reduce((sum, v) => sum + v.traffic_weight, 0);
  if (totalWeight === 0) return sorted[0];

  // djb2 hash of "userId:verticalId"
  const hashInput = `${userId}:${verticalId}`;
  let hash = 5381;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) + hash + hashInput.charCodeAt(i)) >>> 0;
  }

  // Map hash to [0, totalWeight) range
  const bucket = hash % totalWeight;

  let cumulative = 0;
  for (const variant of sorted) {
    cumulative += variant.traffic_weight;
    if (bucket < cumulative) return variant;
  }

  return sorted[sorted.length - 1];
}
