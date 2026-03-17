import { auth } from '@clerk/nextjs/server';
import { getProjectOverview } from '@/lib/dashboard/queries';
import { ok, err } from '@/app/api/analytics/_lib/respond';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return err('Unauthorized', 401);

  const { id } = await params;
  const data = await getProjectOverview(id);
  return ok(data);
}
