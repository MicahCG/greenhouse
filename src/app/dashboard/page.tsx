export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { NewProjectButton } from '@/components/dashboard/new-project-button';
import { ArchiveProjectButton } from '@/components/dashboard/archive-project-button';

async function getProjectsWithStats() {
  const allProjects = await db.select().from(projects);

  return Promise.all(
    allProjects.map(async (project) => {
      const [{ value: verticalCount }] = await db
        .select({ value: count() })
        .from(verticals)
        .where(eq(verticals.project_id, project.id));

      const projectVerticals = await db
        .select({ id: verticals.id })
        .from(verticals)
        .where(eq(verticals.project_id, project.id));

      let variantCount = 0;
      for (const v of projectVerticals) {
        const [{ value }] = await db
          .select({ value: count() })
          .from(variants)
          .where(eq(variants.vertical_id, v.id));
        variantCount += value;
      }

      return { ...project, verticalCount, variantCount };
    })
  );
}

const funnelColors: Record<string, string> = {
  acquisition: 'bg-amber-500/20 text-amber-400',
  activation: 'bg-blue-500/20 text-blue-400',
  monetization: 'bg-green-500/20 text-green-400',
  retention: 'bg-purple-500/20 text-purple-400',
  referral: 'bg-teal-500/20 text-teal-400',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-zinc-500/20 text-zinc-400',
  archived: 'bg-zinc-700/40 text-zinc-500',
};

export default async function DashboardPage() {
  const projectsWithStats = await getProjectsWithStats();
  const activeProjects = projectsWithStats.filter((p) => p.status !== 'archived');

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Active growth experiments across all funnel stages
          </p>
        </div>
        <NewProjectButton />
      </div>

      {activeProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-4xl mb-4 opacity-30">🌱</div>
          <h2 className="text-lg font-semibold mb-2">No projects yet</h2>
          <p className="text-zinc-500 text-sm mb-6 max-w-sm">
            Create your first project to start running A/B experiments on your landing pages.
          </p>
          <NewProjectButton />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activeProjects.map((project) => (
            <div key={project.id} className="border border-white/10 rounded-xl p-5 bg-zinc-900 hover:border-white/25 transition-colors group relative">
              <Link href={`/dashboard/projects/${project.id}`} className="absolute inset-0 rounded-xl" aria-label={project.name} />

              <div className="flex items-start justify-between mb-3">
                <h2 className="font-semibold text-base group-hover:text-white transition-colors pr-2">{project.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColors[project.status] ?? ''}`}>
                  {project.status}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${funnelColors[project.funnel_focus] ?? ''}`}>
                  {project.funnel_focus}
                </span>
              </div>

              {project.description && (
                <p className="text-xs text-zinc-500 mb-4 line-clamp-2">{project.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <p className="text-zinc-500 text-xs mb-1">Verticals</p>
                  <p className="font-semibold text-lg">{project.verticalCount}</p>
                </div>
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <p className="text-zinc-500 text-xs mb-1">Variants</p>
                  <p className="font-semibold text-lg">{project.variantCount}</p>
                </div>
              </div>

              <div className="flex items-center justify-between relative z-10">
                <p className="text-xs text-zinc-600">
                  {Math.round(project.significance_threshold * 100)}% sig · {new Date(project.created_at!).toLocaleDateString()}
                </p>
                <ArchiveProjectButton projectId={project.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
