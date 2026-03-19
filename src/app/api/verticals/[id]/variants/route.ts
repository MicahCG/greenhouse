import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { variants, verticals, variant_versions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { VariantConfigSchema } from '@/lib/types/variant-config';
import { rebalanceWeights, incrementConfigVersion } from '@/lib/experiments/traffic';

const VARIANT_SLUGS = ['variant-a', 'variant-b', 'variant-c', 'variant-d', 'variant-e', 'variant-f'];

const CreateTemplateVariantSchema = z.object({
  variant_type: z.literal('template').optional().default('template'),
  slug: z.string().optional(),
  config: VariantConfigSchema,
  traffic_weight: z.number().int().min(0).max(100).optional(),
});

const CreateExternalVariantSchema = z.object({
  variant_type: z.literal('external_url'),
  slug: z.string().optional(),
  external_url: z.string().url(),
  label: z.string().optional(),
  traffic_weight: z.number().int().min(0).max(100).optional(),
});

const CreateVariantSchema = z.union([CreateTemplateVariantSchema, CreateExternalVariantSchema]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: verticalId } = await params;

  const allVariants = await db
    .select()
    .from(variants)
    .where(eq(variants.vertical_id, verticalId));

  return Response.json(allVariants);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: verticalId } = await params;

  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, verticalId))
    .limit(1);

  if (!vertical) return Response.json({ error: 'Vertical not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateVariantSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const isExternal = parsed.data.variant_type === 'external_url';

  // Build config based on variant type
  let config: Record<string, unknown>;
  let externalUrl: string | null = null;

  if (isExternal) {
    const ext = parsed.data as z.infer<typeof CreateExternalVariantSchema>;
    externalUrl = ext.external_url;
    config = {
      label: ext.label ?? new URL(ext.external_url).hostname,
      external_url: ext.external_url,
      template: 'external',
    };
  } else {
    const tpl = parsed.data as z.infer<typeof CreateTemplateVariantSchema>;
    config = tpl.config as unknown as Record<string, unknown>;
  }

  const traffic_weight = parsed.data.traffic_weight;

  // Auto-generate slug if not provided
  let slug = parsed.data.slug;
  if (!slug) {
    const existingVariants = await db
      .select({ slug: variants.slug })
      .from(variants)
      .where(eq(variants.vertical_id, verticalId));
    const existingSlugs = new Set(existingVariants.map((v) => v.slug));
    slug = VARIANT_SLUGS.find((s) => !existingSlugs.has(s)) ?? `variant-${existingVariants.length + 1}`;
  }

  const [variant] = await db
    .insert(variants)
    .values({
      vertical_id: verticalId,
      slug,
      variant_type: isExternal ? 'external_url' : 'template',
      external_url: externalUrl,
      config,
      traffic_weight: traffic_weight ?? 50,
      version: 1,
    })
    .returning();

  // Save initial version to variant_versions
  await db.insert(variant_versions).values({
    variant_id: variant.id,
    version: 1,
    config,
    changed_by: 'user',
    change_description: 'Initial version',
  });

  // Rebalance if equal strategy
  if (vertical.traffic_split_strategy === 'equal' || vertical.traffic_split_strategy === 'champion_challenger') {
    await rebalanceWeights(verticalId);
  }

  // New variant affects routing — increment config_version
  await incrementConfigVersion(verticalId);

  return Response.json(variant, { status: 201 });
}
