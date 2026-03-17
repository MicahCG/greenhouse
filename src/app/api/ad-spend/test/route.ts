import { auth } from '@clerk/nextjs/server';
import { getAdDateRange } from '@/lib/ad-platforms/unified';

type PlatformStatus = 'connected' | 'missing_credentials' | 'error';

interface TestResult {
  google: PlatformStatus;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result: TestResult = {
    google: 'missing_credentials',
  };

  const { startGoogle, endGoogle } = getAdDateRange(1);
  const googleDateRange = { start: startGoogle, end: endGoogle };

  // Test Google
  if (
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  ) {
    try {
      const { getGoogleCampaigns } = await import('@/lib/ad-platforms/google');
      await getGoogleCampaigns(googleDateRange);
      result.google = 'connected';
    } catch {
      result.google = 'error';
    }
  }

  return Response.json(result);
}
