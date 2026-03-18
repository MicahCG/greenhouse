import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/diagnostics/github — Test GitHub + Amplitude connectivity.
 * Auth-protected. Returns connectivity status for external services.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const results: Record<string, unknown> = {};

  // --- GitHub ---
  const token = process.env.GITHUB_TOKEN;
  const greenhouseRepo = process.env.GITHUB_GREENHOUSE_REPO;
  const popcornRepo = process.env.GITHUB_POPCORN_REPO;

  results.env = {
    GITHUB_TOKEN: token ? `set (${token.slice(0, 4)}...${token.slice(-4)})` : 'MISSING',
    GITHUB_GREENHOUSE_REPO: greenhouseRepo ?? 'MISSING',
    GITHUB_POPCORN_REPO: popcornRepo ?? 'MISSING',
    AMPLITUDE_API_KEY: process.env.AMPLITUDE_API_KEY ? `set (${process.env.AMPLITUDE_API_KEY.slice(0, 6)}...)` : 'MISSING',
    AMPLITUDE_SECRET_KEY: process.env.AMPLITUDE_SECRET_KEY ? `set (${process.env.AMPLITUDE_SECRET_KEY.slice(0, 4)}...)` : 'MISSING',
  };

  // Normalize repo URLs to owner/repo format
  function normalizeRepo(value: string): string {
    try {
      const url = new URL(value);
      if (url.hostname === 'github.com') {
        return url.pathname.replace(/^\//, '').replace(/\/$/, '');
      }
    } catch { /* not a URL */ }
    return value;
  }

  // Test GitHub API access for each repo
  for (const [label, rawRepo] of [['greenhouse', greenhouseRepo], ['popcorn', popcornRepo]] as const) {
    if (!rawRepo || !token) {
      results[label] = { status: 'skipped', reason: 'Missing env var' };
      continue;
    }

    const repo = normalizeRepo(rawRepo);
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      const body = await res.json() as { full_name?: string; message?: string; permissions?: Record<string, boolean> };
      if (res.ok) {
        results[label] = {
          status: 'ok',
          http: res.status,
          full_name: body.full_name,
          permissions: body.permissions,
          resolved_repo: repo,
        };
      } else {
        results[label] = {
          status: 'error',
          http: res.status,
          message: body.message,
          resolved_repo: repo,
        };
      }
    } catch (err) {
      results[label] = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // --- Amplitude ---
  const ampKey = process.env.AMPLITUDE_API_KEY;
  const ampSecret = process.env.AMPLITUDE_SECRET_KEY;

  if (ampKey && ampSecret) {
    try {
      const encoded = Buffer.from(`${ampKey}:${ampSecret}`).toString('base64');
      // Simple test: query a single day of any event
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const testUrl = new URL('https://amplitude.com/api/2/events/segmentation');
      testUrl.searchParams.set('e', JSON.stringify({ event_type: 'Viewed' }));
      testUrl.searchParams.set('start', today);
      testUrl.searchParams.set('end', today);
      testUrl.searchParams.set('m', 'totals');
      testUrl.searchParams.set('i', '1');

      const res = await fetch(testUrl.toString(), {
        headers: { Authorization: `Basic ${encoded}`, Accept: 'application/json' },
        cache: 'no-store',
      });

      if (res.ok) {
        const body = await res.json() as { data?: { series?: number[][] } };
        const total = body.data?.series?.[0]?.reduce((a, b) => a + b, 0) ?? 0;
        results.amplitude = {
          status: 'ok',
          http: res.status,
          test_event: 'Viewed',
          test_date: today,
          total_today: total,
        };
      } else {
        const body = await res.text();
        results.amplitude = {
          status: 'error',
          http: res.status,
          message: body.slice(0, 200),
        };
      }
    } catch (err) {
      results.amplitude = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    results.amplitude = {
      status: 'skipped',
      reason: `Missing: ${!ampKey ? 'AMPLITUDE_API_KEY' : ''} ${!ampSecret ? 'AMPLITUDE_SECRET_KEY' : ''}`.trim(),
    };
  }

  return Response.json(results);
}
