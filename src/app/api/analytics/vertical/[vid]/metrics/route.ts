import { auth } from '@clerk/nextjs/server';
import { getVerticalMetrics } from '@/lib/dashboard/queries';
import { ok, err } from '@/app/api/analytics/_lib/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vid: string }> }
) {
  const { userId } = await auth();
  if (!userId) return err('Unauthorized', 401);

  const { vid } = await params;
  const url = new URL(request.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '30', 10);

  const data = await getVerticalMetrics(vid, windowDays);
  return ok(data);
}
