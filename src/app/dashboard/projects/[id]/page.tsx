export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getData(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const allVerticals = await db.select().from(verticals).where(eq(verticals.project_id, projectId));

  const verticalsWithVariants = await Promise.all(
    allVerticals.map(async (vertical) => {
      const allVariants = await db
        .select()
        .from(variants)
        .where(eq(variants.vertical_id, vertical.id));
      return { ...vertical, variants: allVariants };
    })
  );

  return { project, verticals: verticalsWithVariants };
}

const statusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  archived: 'bg-zinc-500/20 text-zinc-400',
};

const variantStatusColors: Record<string, string> = {
  active: 'text-green-400',
  paused: 'text-yellow-400',
  winner: 'text-amber-400',
  killed: 'text-red-400',
};

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  const { project, verticals: verticalsData } = data;

  return (
    <div>
      <div className="mb-8">
        <p className="text-zinc-500 text-sm mb-1">
          <Link href="/dashboard" className="hover:text-white">Projects</Link>
          {' / '}
          {project.name}
        </p>
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="text-zinc-500 text-sm mt-1 capitalize">{project.funnel_focus} funnel</p>
      </div>

      <div className="space-y-4">
        {verticalsData.map((vertical) => (
          <div key={vertical.id} className="border border-white/10 rounded-xl bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-white/5">
              <div>
                <h2 className="font-semibold">{vertical.name}</h2>
                <p className="text-zinc-500 text-xs mt-0.5">/{vertical.slug}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[vertical.status] ?? ''}`}>
                {vertical.status}
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {vertical.variants.map((variant) => {
                const config = variant.config as { headline?: string; template?: string };
                return (
                  <Link
                    key={variant.id}
                    href={`/dashboard/projects/${project.id}/verticals/${vertical.id}/variants/${variant.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex-1">
                      <span className="text-sm font-medium">{variant.slug}</span>
                      <span className="text-zinc-600 text-xs ml-2">v{variant.version}</span>
                      {config?.headline && (
                        <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-sm">{config.headline}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      {config?.template && (
                        <span className="text-zinc-600 font-mono">{config.template}</span>
                      )}
                      <span className="text-zinc-600">{variant.traffic_weight}% traffic</span>
                      <span className={`font-medium ${variantStatusColors[variant.status] ?? ''}`}>
                        {variant.status}
                      </span>
                      <span className="text-zinc-600">—</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="px-5 py-3 bg-zinc-800/30 flex items-center gap-3 text-xs text-zinc-500">
              <span>{vertical.variants.length} variants</span>
              <span>·</span>
              <span>{vertical.traffic_split_strategy} split</span>
              <span className="flex-1" />
              <Link
                href={`/lp/${vertical.slug}`}
                target="_blank"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                View landing page ↗
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
