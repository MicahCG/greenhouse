import { db } from '@/lib/db';
import { verticals, variants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { queryEventSeries, getDateRange } from '@/lib/amplitude/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vid: string }> }
) {
  const { vid } = await params;

  const [vertical] = await db.select().from(verticals).where(eq(verticals.id, vid)).limit(1);
  if (!vertical) return Response.json({ error: 'Not found' }, { status: 404 });

  const { start, end } = getDateRange(30);

  // Collect all paths to query from variant URLs (control variant covers the source page)
  const paths: string[] = [];

  const allVariants = await db.select().from(variants).where(eq(variants.vertical_id, vid));
  for (const v of allVariants) {
    if (v.external_url) {
      try {
        const p = new URL(v.external_url).pathname;
        if (!paths.includes(p)) paths.push(p);
      } catch {
        const p = v.external_url.startsWith('/') ? v.external_url : `/${v.external_url}`;
        if (!paths.includes(p)) paths.push(p);
      }
    }
  }

  if (paths.length === 0) {
    return Response.json({ daily: [] });
  }

  // Query Viewed event for all paths combined
  const series = await queryEventSeries({
    event: 'Viewed',
    start,
    end,
    metric: 'uniques',
    filters: [{ subprop_type: 'event', subprop_key: 'path', subprop_op: 'is', subprop_value: paths }],
  });

  return Response.json({
    daily: series.map((p) => ({ date: p.date, visitors: p.value })),
    paths,
  });
}
