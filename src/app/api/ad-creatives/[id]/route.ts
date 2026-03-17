import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ad_creatives, ad_assignments, verticals, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [creative] = await db
    .select()
    .from(ad_creatives)
    .where(eq(ad_creatives.id, id))
    .limit(1);

  if (!creative) return Response.json({ error: 'Not found' }, { status: 404 });

  // Fetch assignments joined with vertical and variant names
  const assignments = await db
    .select({
      id: ad_assignments.id,
      ad_creative_id: ad_assignments.ad_creative_id,
      vertical_id: ad_assignments.vertical_id,
      variant_id: ad_assignments.variant_id,
      status: ad_assignments.status,
      utm_content_tag: ad_assignments.utm_content_tag,
      daily_budget: ad_assignments.daily_budget,
      start_date: ad_assignments.start_date,
      end_date: ad_assignments.end_date,
      notes: ad_assignments.notes,
      created_at: ad_assignments.created_at,
      vertical_name: verticals.name,
      vertical_slug: verticals.slug,
      variant_slug: variants.slug,
    })
    .from(ad_assignments)
    .leftJoin(verticals, eq(ad_assignments.vertical_id, verticals.id))
    .leftJoin(variants, eq(ad_assignments.variant_id, variants.id))
    .where(eq(ad_assignments.ad_creative_id, id));

  return Response.json({ ...creative, assignments });
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

  const {
    name,
    platform,
    format,
    status,
    copy_headline,
    copy_body,
    copy_cta,
    media_url,
    thumbnail_url,
    platform_campaign_id,
    platform_ad_id,
    notes,
  } = body as Record<string, string | undefined>;

  const [existing] = await db
    .select()
    .from(ad_creatives)
    .where(eq(ad_creatives.id, id))
    .limit(1);

  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  // Detect if any copy fields changed to auto-increment version
  const copyChanged =
    (copy_headline !== undefined && copy_headline !== existing.copy_headline) ||
    (copy_body !== undefined && copy_body !== existing.copy_body) ||
    (copy_cta !== undefined && copy_cta !== existing.copy_cta);

  const updates: Partial<typeof ad_creatives.$inferInsert> = {
    updated_at: new Date(),
  };

  if (name !== undefined) updates.name = name;
  if (platform !== undefined) updates.platform = platform;
  if (format !== undefined) updates.format = format;
  if (status !== undefined) updates.status = status;
  if (copy_headline !== undefined) updates.copy_headline = copy_headline;
  if (copy_body !== undefined) updates.copy_body = copy_body;
  if (copy_cta !== undefined) updates.copy_cta = copy_cta;
  if (media_url !== undefined) updates.media_url = media_url;
  if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;
  if (platform_campaign_id !== undefined) updates.platform_campaign_id = platform_campaign_id;
  if (platform_ad_id !== undefined) updates.platform_ad_id = platform_ad_id;
  if (notes !== undefined) updates.notes = notes;

  if (copyChanged) {
    updates.version = existing.version + 1;
  }

  const [updated] = await db
    .update(ad_creatives)
    .set(updates)
    .where(eq(ad_creatives.id, id))
    .returning();

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [updated] = await db
    .update(ad_creatives)
    .set({ status: 'archived', updated_at: new Date() })
    .where(eq(ad_creatives.id, id))
    .returning();

  if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ success: true });
}
