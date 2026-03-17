import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ad_assignments, ad_creatives, verticals, variants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

function buildUtmTag(params: {
  platform: string;
  format: string;
  version: number;
  verticalSlug: string;
  variantSlug?: string | null;
}): string {
  const { platform, format, version, verticalSlug, variantSlug } = params;
  const variantPart = variantSlug || 'all';
  return `${platform}-${format}-v${version}-${verticalSlug}-${variantPart}`;
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const verticalId = searchParams.get('verticalId');
  const adCreativeId = searchParams.get('adCreativeId');
  const projectId = searchParams.get('projectId');

  // Build base query with joins
  const baseQuery = db
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
      creative_name: ad_creatives.name,
      creative_platform: ad_creatives.platform,
      creative_format: ad_creatives.format,
      creative_version: ad_creatives.version,
      vertical_name: verticals.name,
      vertical_slug: verticals.slug,
      variant_slug: variants.slug,
    })
    .from(ad_assignments)
    .leftJoin(ad_creatives, eq(ad_assignments.ad_creative_id, ad_creatives.id))
    .leftJoin(verticals, eq(ad_assignments.vertical_id, verticals.id))
    .leftJoin(variants, eq(ad_assignments.variant_id, variants.id));

  let rows;

  if (verticalId) {
    rows = await baseQuery.where(eq(ad_assignments.vertical_id, verticalId));
  } else if (adCreativeId) {
    rows = await baseQuery.where(eq(ad_assignments.ad_creative_id, adCreativeId));
  } else if (projectId) {
    // Filter by project through verticals join
    rows = await baseQuery.where(eq(verticals.project_id, projectId));
  } else {
    rows = await baseQuery;
  }

  return Response.json(rows);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    ad_creative_id,
    vertical_id,
    variant_id,
    daily_budget,
    start_date,
    end_date,
    notes,
  } = body as {
    ad_creative_id?: string;
    vertical_id?: string;
    variant_id?: string | null;
    daily_budget?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
  };

  if (!ad_creative_id || !vertical_id) {
    return Response.json(
      { error: 'ad_creative_id and vertical_id are required' },
      { status: 400 }
    );
  }

  // Look up creative for platform/format/version
  const [creative] = await db
    .select()
    .from(ad_creatives)
    .where(eq(ad_creatives.id, ad_creative_id))
    .limit(1);

  if (!creative) {
    return Response.json({ error: 'Ad creative not found' }, { status: 404 });
  }

  // Look up vertical for slug
  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, vertical_id))
    .limit(1);

  if (!vertical) {
    return Response.json({ error: 'Vertical not found' }, { status: 404 });
  }

  // Look up variant slug if provided
  let variantSlug: string | null = null;
  if (variant_id) {
    const [variant] = await db
      .select()
      .from(variants)
      .where(and(eq(variants.id, variant_id), eq(variants.vertical_id, vertical_id)))
      .limit(1);

    if (!variant) {
      return Response.json({ error: 'Variant not found in specified vertical' }, { status: 404 });
    }
    variantSlug = variant.slug;
  }

  // Generate UTM tag
  const utm_content_tag = buildUtmTag({
    platform: creative.platform,
    format: creative.format,
    version: creative.version,
    verticalSlug: vertical.slug,
    variantSlug,
  });

  const [assignment] = await db
    .insert(ad_assignments)
    .values({
      ad_creative_id,
      vertical_id,
      variant_id: variant_id ?? null,
      utm_content_tag,
      daily_budget: daily_budget ?? null,
      start_date: start_date ? new Date(start_date) : new Date(),
      end_date: end_date ? new Date(end_date) : null,
      notes: notes ?? null,
    })
    .returning();

  return Response.json({ assignment, utm_content_tag }, { status: 201 });
}
