export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { verticals, variants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { VariantConfigSchema } from '@/lib/types/variant-config';
import { TrackingWrapper } from '@/components/landing-pages/tracking-wrapper';
import { HeroCentered } from '@/components/landing-pages/templates/hero-centered';
import { HeroSplit } from '@/components/landing-pages/templates/hero-split';

interface PageProps {
  params: Promise<{ vertical: string; variant: string }>;
}

async function getVariantData(verticalSlug: string, variantSlug: string) {
  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.slug, verticalSlug))
    .limit(1);

  if (!vertical) return null;

  const [variant] = await db
    .select()
    .from(variants)
    .where(and(eq(variants.vertical_id, vertical.id), eq(variants.slug, variantSlug)))
    .limit(1);

  if (!variant || variant.status !== 'active') return null;

  return { vertical, variant };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { vertical: verticalSlug, variant: variantSlug } = await params;
  const data = await getVariantData(verticalSlug, variantSlug);

  if (!data) return { title: 'Not Found' };

  const config = VariantConfigSchema.safeParse(data.variant.config);
  if (!config.success) return { title: 'Popcorn' };

  return {
    title: config.data.meta_title,
    description: config.data.meta_description,
    openGraph: config.data.og_image
      ? { images: [{ url: config.data.og_image }] }
      : undefined,
  };
}

export default async function LandingPage({ params }: PageProps) {
  const { vertical: verticalSlug, variant: variantSlug } = await params;
  const data = await getVariantData(verticalSlug, variantSlug);

  if (!data) notFound();

  const configResult = VariantConfigSchema.safeParse(data.variant.config);
  if (!configResult.success) notFound();

  const config = configResult.data;

  // Look up project_id via vertical
  const vertical = data.vertical;
  const variant = data.variant;

  let TemplateComponent;
  switch (config.template) {
    case 'hero-split':
      TemplateComponent = HeroSplit;
      break;
    case 'hero-centered':
    default:
      TemplateComponent = HeroCentered;
  }

  return (
    <TrackingWrapper
      projectId={vertical.project_id}
      verticalId={vertical.id}
      variantId={variant.id}
      variantVersion={variant.version}
    >
      <TemplateComponent config={config} />
    </TrackingWrapper>
  );
}
