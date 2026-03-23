export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, verticals, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getFunnelData, getVerticalMetrics } from '@/lib/dashboard/queries';
import { ProjectFunnelChart } from './project-charts';
import { VerticalSection } from '@/components/dashboard/vertical-section';
import { AddVerticalButton } from '@/components/dashboard/add-vertical-button';
import { ProjectSettings } from '@/components/dashboard/project-settings';

interface PageProps {
  params: Promise<{ id: string }>;
}

const funnelColors: Record<string, string> = {
  acquisition: 'bg-amber-500/20 text-amber-400',
  activation: 'bg-blue-500/20 text-blue-400',
  monetization: 'bg-green-500/20 text-green-400',
  retention: 'bg-purple-500/20 text-purple-400',
  referral: 'bg-teal-500/20 text-teal-400',
};

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function getData(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return null;

  const allVerticals = await db
    .select()
    .from(verticals)
    .where(eq(verticals.project_id, projectId));

  const verticalsWithVariants = await Promise.all(
    allVerticals.map(async (vertical) => {
      const [allVariants, metricsResult] = await Promise.all([
        db.select().from(variants).where(eq(variants.vertical_id, vertical.id)),
        getVerticalMetrics(vertical.id, 30),
      ]);
      const metricsMap = Object.fromEntries(
        metricsResult.variants.map((v) => [
          v.id,
          {
            visitors: v.visitors,
            clicks: v.clicks,
            convRate: v.convRate,
            significance: v.significance,
            sampleStatus: v.sampleStatus,
          },
        ])
      );
      return {
        ...vertical,
        variants: allVariants,
        metricsMap,
        controlSlug: metricsResult.controlSlug,
      };
    })
  );

  // Sort verticals by total visitors (highest first)
  verticalsWithVariants.sort((a, b) => {
    const totalA = Object.values(a.metricsMap).reduce((sum, m) => sum + (m.visitors ?? 0), 0);
    const totalB = Object.values(b.metricsMap).reduce((sum, m) => sum + (m.visitors ?? 0), 0);
    return totalB - totalA;
  });

  const funnelData = await getFunnelData(projectId, 30);

  return { project, verticals: verticalsWithVariants, funnelData };
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  const { project, verticals: verticalsData, funnelData } = data;

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="mb-8">
        <p className="text-zinc-500 text-sm mb-1">
          <Link href="/dashboard" className="hover:text-white transition-colors">
            Projects
          </Link>
          {' / '}
          <span className="text-zinc-300">{project.name}</span>
        </p>
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${funnelColors[project.funnel_focus] ?? ''}`}>
                {project.funnel_focus}
              </span>
            </div>
            <p className="text-zinc-500 text-sm mt-1">
              {Math.round(project.significance_threshold * 100)}% significance threshold
              {project.description && ` · ${project.description}`}
            </p>
          </div>
          <div className="flex-1" />
          <ProjectSettings
            projectId={project.id}
            currentName={project.name}
            currentEvents={project.tracked_events ?? []}
            currentDescription={project.description ?? ''}
            currentThreshold={project.significance_threshold}
          />
          <AddVerticalButton projectId={project.id} />
        </div>
      </div>

      {/* Verticals */}
      {verticalsData.length === 0 ? (
        <div className="border border-white/10 rounded-xl bg-zinc-900 p-12 text-center">
          <p className="text-zinc-500 mb-4">No verticals yet. Add a vertical to start experimenting.</p>
          <AddVerticalButton projectId={project.id} />
        </div>
      ) : (
        <div className="space-y-4">
          {verticalsData.map((vertical) => (
            <VerticalSection
              key={vertical.id}
              projectId={project.id}
              vertical={vertical}
              variants={vertical.variants}
              metricsMap={vertical.metricsMap}
              controlSlug={vertical.controlSlug}
              funnelFocus={project.funnel_focus}
            />
          ))}
        </div>
      )}

      {/* Funnel Section */}
      <div className="mt-6 border border-white/10 rounded-xl bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Conversion Funnel (30d)</h2>
          {funnelData.overallConvRate > 0 && (
            <span className="text-xs text-zinc-500">
              Overall:{' '}
              <span className="text-amber-400 font-medium">
                {formatPct(funnelData.overallConvRate)}
              </span>
            </span>
          )}
        </div>
        <ProjectFunnelChart steps={funnelData.steps} />
      </div>
    </div>
  );
}
