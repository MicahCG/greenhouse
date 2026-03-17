import { auth } from '@clerk/nextjs/server';
import { getFileContent } from '@/lib/github/client';
import { resolveRepo, isRepoKey } from '@/lib/github/permissions';
import { extractSourceContent } from '@/lib/agent/source-extractor';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const repo = url.searchParams.get('repo') ?? 'popcorn';
  const path = url.searchParams.get('path');

  if (!path) {
    return Response.json({ error: 'path parameter is required' }, { status: 400 });
  }

  if (!isRepoKey(repo)) {
    return Response.json({ error: 'repo must be "greenhouse" or "popcorn"' }, { status: 400 });
  }

  try {
    const repoFull = resolveRepo(repo);
    const file = await getFileContent(repoFull, path);
    const result = extractSourceContent(file.content, path);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
