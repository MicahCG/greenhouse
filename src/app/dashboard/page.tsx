export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';

async function getProjectsWithStats() {
  const allProjects = await db.select().from(projects);

  return Promise.all(
    allProjects.map(async (project) => {
      const [{ value: verticalCount }] = await db
        .select({ value: count() })
        .from(verticals)
        .where(eq(verticals.project_id, project.id));

      return { ...project, verticalCount };
    })
  );
}

const funnelColors: Record<string, string> = {
  acquisition: 'bg-amber-500/20 text-amber-400',
  activation: 'bg-blue-500/20 text-blue-400',
  monetization: 'bg-green-500/20 text-green-400',
  retention: 'bg-purple-500/20 text-purple-400',
  referral: 'bg-pink-500/20 text-pink-400',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-zinc-500/20 text-zinc-400',
};

export default async function DashboardPage() {
  const projectsWithStats = await getProjectsWithStats();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="text-zinc-500 text-sm mt-1">Active growth experiments across all funnel stages</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projectsWithStats.map((project) => (
          <Link
            key={project.id}
            href={`/dashboard/projects/${project.id}`}
            className="block border border-white/10 rounded-xl p-5 bg-zinc-900 hover:border-white/25 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="font-semibold text-base">{project.name}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[project.status] ?? ''}`}>
                {project.status}
              </span>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${funnelColors[project.funnel_focus] ?? ''}`}>
                {project.funnel_focus}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <p className="text-zinc-500 text-xs mb-1">Verticals</p>
                <p className="font-semibold text-lg">{project.verticalCount}</p>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <p className="text-zinc-500 text-xs mb-1">Significance</p>
                <p className="font-semibold text-lg">{Math.round(project.significance_threshold * 100)}%</p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 mt-4">
              Created {new Date(project.created_at!).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
