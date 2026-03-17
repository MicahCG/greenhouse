/**
 * One-off migration: sets tracked_events = ['Page View', 'User Signed Up']
 * on all projects that don't already have 2 tracked events.
 *
 * Run with: npx tsx src/lib/db/backfill-tracked-events.ts
 */

import { db } from './index';
import { projects } from './schema';
import { eq } from 'drizzle-orm';

async function backfill() {
  const allProjects = await db.select().from(projects);
  let updated = 0;

  for (const project of allProjects) {
    const events = project.tracked_events;
    if (events && events.length === 2) {
      console.log(`[skip] "${project.name}" already has tracked_events: ${JSON.stringify(events)}`);
      continue;
    }

    await db
      .update(projects)
      .set({
        tracked_events: ['Page View', 'User Signed Up'],
        updated_at: new Date(),
      })
      .where(eq(projects.id, project.id));

    console.log(`[updated] "${project.name}" → tracked_events: ["Page View", "User Signed Up"]`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} project(s).`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
