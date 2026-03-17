import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/diagnostics/github — Test GitHub connectivity.
 * Auth-protected. Returns connectivity status for both repos.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const results: Record<string, unknown> = {};

  // Check env vars
  const token = process.env.GITHUB_TOKEN;
  const greenhouseRepo = process.env.GITHUB_GREENHOUSE_REPO;
  const popcornRepo = process.env.GITHUB_POPCORN_REPO;

  results.env = {
    GITHUB_TOKEN: token ? `set (${token.slice(0, 4)}...${token.slice(-4)})` : 'MISSING',
    GITHUB_GREENHOUSE_REPO: greenhouseRepo ?? 'MISSING',
    GITHUB_POPCORN_REPO: popcornRepo ?? 'MISSING',
  };

  // Test API access for each repo
  for (const [label, repo] of [['greenhouse', greenhouseRepo], ['popcorn', popcornRepo]] as const) {
    if (!repo || !token) {
      results[label] = { status: 'skipped', reason: 'Missing env var' };
      continue;
    }

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
        };
      } else {
        results[label] = {
          status: 'error',
          http: res.status,
          message: body.message,
        };
      }
    } catch (err) {
      results[label] = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return Response.json(results);
}
