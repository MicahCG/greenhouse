/**
 * One-time script to fix tracked_events for the
 * "Channel Creation to Package Purchase" project.
 *
 * Run with: npx tsx src/lib/db/fix-tracked-events.ts
 */
import { db } from './index';
import { projects } from './schema';
import { eq } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.name, 'Channel Creation to Package Purchase'));

  if (rows.length === 0) {
    console.log('Project "Channel Creation to Package Purchase" not found. Skipping.');
    process.exit(0);
  }

  for (const row of rows) {
    console.log(`Updating project ${row.id} tracked_events...`);
    await db
      .update(projects)
      .set({ tracked_events: ['Channel Created', 'Credits Purchased'] })
      .where(eq(projects.id, row.id));
    console.log(`  Done. Was: ${JSON.stringify(row.tracked_events)} → Now: ['Channel Created', 'Credits Purchased']`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
