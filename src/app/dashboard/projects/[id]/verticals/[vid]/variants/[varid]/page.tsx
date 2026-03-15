export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, verticals, variants, agent_changes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { VariantConfigSchema } from '@/lib/types/variant-config';

interface PageProps {
  params: Promise<{ id: string; vid: string; varid: string }>;
}

async function getData(projectId: string, verticalId: string, variantId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const [vertical] = await db.select().from(verticals).where(eq(verticals.id, verticalId)).limit(1);
  const [variant] = await db.select().from(variants).where(eq(variants.id, variantId)).limit(1);

  if (!project || !vertical || !variant) return null;

  const changes = await db
    .select()
    .from(agent_changes)
    .where(eq(agent_changes.variant_id, variantId));

  return { project, vertical, variant, changes };
}

export default async function VariantDetailPage({ params }: PageProps) {
  const { id, vid, varid } = await params;
  const data = await getData(id, vid, varid);
  if (!data) notFound();

  const { project, vertical, variant, changes } = data;
  const configResult = VariantConfigSchema.safeParse(variant.config);
  const config = configResult.success ? configResult.data : null;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 text-sm text-zinc-500">
        <Link href="/dashboard" className="hover:text-white">Projects</Link>
        {' / '}
        <Link href={`/dashboard/projects/${project.id}`} className="hover:text-white">{project.name}</Link>
        {' / '}
        <span>{vertical.name}</span>
        {' / '}
        <span className="text-white">{variant.slug}</span>
      </div>

      <div className="flex items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">{variant.slug}</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {vertical.name} · v{variant.version} ·{' '}
            <span className={variant.status === 'active' ? 'text-green-400' : 'text-zinc-400'}>
              {variant.status}
            </span>
          </p>
        </div>
        <div className="flex-1" />
        <Link
          href={`/lp/${vertical.slug}/${variant.slug}`}
          target="_blank"
          className="text-sm border border-white/20 px-4 py-2 rounded-lg hover:border-white/40 transition-colors"
        >
          View live ↗
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance chart placeholder */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
            <h2 className="font-semibold mb-4">Performance Over Time</h2>
            <div className="h-48 flex items-center justify-center text-zinc-600 border border-white/5 rounded-lg bg-zinc-800/30">
              Charts coming in Phase 2
            </div>
          </div>

          <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
            <h2 className="font-semibold mb-4">Traffic Source Breakdown</h2>
            <div className="h-32 flex items-center justify-center text-zinc-600 border border-white/5 rounded-lg bg-zinc-800/30">
              Analytics coming in Phase 2
            </div>
          </div>

          {/* Agent Change Log */}
          <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
            <h2 className="font-semibold mb-4">Change Log</h2>
            {changes.length === 0 ? (
              <p className="text-zinc-600 text-sm">No agent changes yet.</p>
            ) : (
              <div className="space-y-3">
                {changes.map((change) => (
                  <div key={change.id} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono bg-zinc-800 px-2 py-0.5 rounded">
                        {change.change_type}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        change.verdict === 'win' ? 'bg-green-500/20 text-green-400' :
                        change.verdict === 'loss' ? 'bg-red-500/20 text-red-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {change.verdict}
                      </span>
                    </div>
                    <p className="text-sm font-medium mb-1">{change.hypothesis}</p>
                    <p className="text-xs text-zinc-500">{change.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Variant config sidebar */}
        <div className="space-y-4">
          <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
            <h2 className="font-semibold mb-4">Variant Config</h2>
            {config ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Template</p>
                  <p className="font-mono text-xs bg-zinc-800 px-2 py-1 rounded">{config.template}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Headline</p>
                  <p className="font-medium">{config.headline}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Subheadline</p>
                  <p className="text-zinc-400 text-xs">{config.subheadline}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Primary CTA</p>
                  <p className="text-amber-400 font-medium">{config.cta_primary.text}</p>
                </div>
                {config.cta_secondary && (
                  <div>
                    <p className="text-zinc-500 text-xs mb-1">Secondary CTA</p>
                    <p className="text-zinc-400">{config.cta_secondary.text}</p>
                  </div>
                )}
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Traffic Weight</p>
                  <p className="font-medium">{variant.traffic_weight}%</p>
                </div>
              </div>
            ) : (
              <p className="text-red-400 text-xs">Invalid config schema</p>
            )}
          </div>

          <div className="border border-white/10 rounded-xl bg-zinc-900 p-5">
            <h2 className="font-semibold mb-4">Quick Stats</h2>
            <div className="space-y-3">
              {[
                { label: 'Conversion Rate', value: '—' },
                { label: 'Visitors (7d)', value: '—' },
                { label: 'CTA Click Rate', value: '—' },
              ].map((stat) => (
                <div key={stat.label} className="flex justify-between text-sm">
                  <span className="text-zinc-500">{stat.label}</span>
                  <span className="text-zinc-400">{stat.value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-4">Analytics in Phase 2</p>
          </div>
        </div>
      </div>
    </div>
  );
}
