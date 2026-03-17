import { auth } from '@clerk/nextjs/server';
import { getVariantTimeSeries, getVariantTrafficSources } from '@/lib/dashboard/queries';
import { ok, err } from '@/app/api/analytics/_lib/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ varid: string }> }
) {
  const { userId } = await auth();
  if (!userId) return err('Unauthorized', 401);

  const { varid } = await params;
  const url = new URL(request.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '30', 10);

  const [timeSeries, trafficSources] = await Promise.all([
    getVariantTimeSeries(varid, windowDays),
    getVariantTrafficSources(varid, windowDays),
  ]);

  return ok({ timeSeries, trafficSources });
}
