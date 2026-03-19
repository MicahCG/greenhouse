import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { variants, variant_versions, agent_changes, user_assignments } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { VariantConfigSchema } from '@/lib/types/variant-config';
import { incrementConfigVersion } from '@/lib/experiments/traffic';

const PatchTemplateSchema = z.object({
  config: VariantConfigSchema.optional(),
  external_url: z.undefined().optional(),
  status: z.enum(['active', 'paused', 'winner', 'killed']).optional(),
  traffic_weight: z.number().int().min(0).max(100).optional(),
  change_description: z.string().optional(),
  changed_by: z.enum(['user', 'agent']).optional().default('user'),
});

const PatchExternalSchema = z.object({
  external_url: z.string().url().optional(),
  label: z.string().optional(),
  status: z.enum(['active', 'paused', 'winner', 'killed']).optional(),
  traffic_weight: z.number().int().min(0).max(100).optional(),
  change_description: z.string().optional(),
  changed_by: z.enum(['user', 'agent']).optional().default('user'),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [variant] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  if (!variant) return Response.json({ error: 'Not found' }, { status: 404 });

  const versions = await db
    .select()
    .from(variant_versions)
    .where(eq(variant_versions.variant_id, id));

  return Response.json({ ...variant, versions });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const [existing] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const isExternal = existing.variant_type === 'external_url';

  // Validate based on variant type
  if (isExternal) {
    const parsed = PatchExternalSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    const updates: Partial<typeof variants.$inferInsert> = {};
    let newVersion = existing.version;

    // Update external URL or label
    if (parsed.data.external_url !== undefined || parsed.data.label !== undefined) {
      const currentConfig = existing.config as Record<string, unknown>;
      const newConfig = { ...currentConfig };
      if (parsed.data.external_url) {
        newConfig.external_url = parsed.data.external_url;
        updates.external_url = parsed.data.external_url;
      }
      if (parsed.data.label) newConfig.label = parsed.data.label;

      await db.insert(variant_versions).values({
        variant_id: id,
        version: existing.version,
        config: existing.config as Record<string, unknown>,
        changed_by: parsed.data.changed_by ?? 'user',
        change_description: parsed.data.change_description,
      });

      newVersion = existing.version + 1;
      updates.config = newConfig;
      updates.version = newVersion;
    }

    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.traffic_weight !== undefined) updates.traffic_weight = parsed.data.traffic_weight;
    updates.updated_at = new Date();

    const [updated] = await db.update(variants).set(updates).where(eq(variants.id, id)).returning();

    // Weight change affects traffic routing — increment config_version
    if (parsed.data.traffic_weight !== undefined && parsed.data.traffic_weight !== existing.traffic_weight) {
      await incrementConfigVersion(existing.vertical_id);
    }

    return Response.json(updated);
  }

  // Template variant
  const parsed = PatchTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const updates: Partial<typeof variants.$inferInsert> = {};
  let newVersion = existing.version;

  // If config is changing, save current to variant_versions and increment version
  if (parsed.data.config !== undefined) {
    // Archive current config as a version snapshot
    await db.insert(variant_versions).values({
      variant_id: id,
      version: existing.version,
      config: existing.config as Record<string, unknown>,
      changed_by: parsed.data.changed_by ?? 'user',
      change_description: parsed.data.change_description,
    });

    newVersion = existing.version + 1;
    updates.config = parsed.data.config as unknown as Record<string, unknown>;
    updates.version = newVersion;
  }

  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.traffic_weight !== undefined) updates.traffic_weight = parsed.data.traffic_weight;
  updates.updated_at = new Date();

  const [updated] = await db.update(variants).set(updates).where(eq(variants.id, id)).returning();

  // Weight change affects traffic routing — increment config_version
  if (parsed.data.traffic_weight !== undefined && parsed.data.traffic_weight !== existing.traffic_weight) {
    await incrementConfigVersion(existing.vertical_id);
  }

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Hard delete — clean up dependent records first
  await db.delete(user_assignments).where(eq(user_assignments.variant_id, id));
  await db.delete(variant_versions).where(eq(variant_versions.variant_id, id));
  await db.delete(agent_changes).where(eq(agent_changes.variant_id, id));

  const [deleted] = await db
    .delete(variants)
    .where(eq(variants.id, id))
    .returning();

  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ success: true });
}
