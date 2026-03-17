import { auth } from '@clerk/nextjs/server';
import { getTrafficOverview } from '@/lib/dashboard/queries';
import { ok, err } from '@/app/api/analytics/_lib/respond';

export async function GET(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return err('Unauthorized', 401);

  const url = new URL(request.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '30', 10);

  const data = await getTrafficOverview(windowDays);
  return ok(data);
}
