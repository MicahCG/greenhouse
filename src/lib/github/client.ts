import { Octokit } from 'octokit';

// ---------------------------------------------------------------------------
// Octokit singleton
// ---------------------------------------------------------------------------

let _octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!_octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is not set');
    _octokit = new Octokit({ auth: token });
  }
  return _octokit;
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo format: "${repo}" — expected "owner/repo"`);
  return { owner, repo: name };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileContent {
  content: string; // decoded UTF-8
  sha: string;
  path: string;
  encoding: string;
}

export interface PullRequestStatus {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  url: string;
  headBranch: string;
  reviewComments: number;
  createdAt: string;
}

export interface CreatePRResult {
  number: number;
  url: string;
  headBranch: string;
}

export interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

// ---------------------------------------------------------------------------
// getFileContent
// ---------------------------------------------------------------------------

export async function getFileContent(
  repoFull: string,
  path: string,
  branch?: string
): Promise<FileContent> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  const params: Record<string, string> = { owner, repo, path };
  if (branch) params.ref = branch;

  let data;
  try {
    const resp = await octokit.rest.repos.getContent(params as Parameters<typeof octokit.rest.repos.getContent>[0]);
    data = resp.data;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      throw new Error(`File not found: "${path}" in ${repoFull}${branch ? ` (branch: ${branch})` : ''}. Check that the path is correct.`);
    }
    if (status === 401 || status === 403) {
      throw new Error(`GitHub auth failed (${status}) reading "${path}" from ${repoFull}. Your GITHUB_TOKEN may be expired or missing repo permissions.`);
    }
    throw err;
  }

  if (Array.isArray(data)) {
    throw new Error(`Path "${path}" is a directory, not a file`);
  }
  if (data.type !== 'file') {
    throw new Error(`Path "${path}" is not a file (type: ${data.type})`);
  }

  const raw = data as { content: string; encoding: string; sha: string; path: string };
  const decoded =
    raw.encoding === 'base64'
      ? Buffer.from(raw.content.replace(/\n/g, ''), 'base64').toString('utf-8')
      : raw.content;

  return { content: decoded, sha: raw.sha, path: raw.path, encoding: raw.encoding };
}

// ---------------------------------------------------------------------------
// createBranch
// ---------------------------------------------------------------------------

export async function createBranch(
  repoFull: string,
  branchName: string,
  fromBranch = 'main'
): Promise<void> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  // Get SHA of the source branch
  let baseSha: string;
  try {
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${fromBranch}`,
    });
    baseSha = ref.object.sha;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      throw new Error(`Base branch "${fromBranch}" not found in ${repoFull}. Check that the repo exists and your GITHUB_TOKEN has access.`);
    }
    if (status === 401 || status === 403) {
      throw new Error(`GitHub auth failed (${status}) reading ${repoFull}. Your GITHUB_TOKEN may be expired or missing repo permissions.`);
    }
    throw err;
  }

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 422) {
      // Branch already exists — update it to latest base SHA instead of failing
      try {
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
          sha: baseSha,
          force: true,
        });
        return;
      } catch {
        throw new Error(`Branch "${branchName}" already exists and could not be updated.`);
      }
    }
    if (status === 401 || status === 403) {
      throw new Error(`GitHub auth failed (${status}) creating branch in ${repoFull}. Your GITHUB_TOKEN may be expired or missing write permissions.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateFile
// ---------------------------------------------------------------------------

export async function updateFile(
  repoFull: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha: string
): Promise<string> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
    sha,
  });

  return (data.commit as { sha: string }).sha;
}

// ---------------------------------------------------------------------------
// createFile (for new files that don't exist yet)
// ---------------------------------------------------------------------------

export async function createFile(
  repoFull: string,
  path: string,
  content: string,
  message: string,
  branch: string
): Promise<string> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  try {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    });

    return (data.commit as { sha: string }).sha;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new Error(`GitHub auth failed (${status}) writing "${path}" to ${repoFull}. Your GITHUB_TOKEN may be expired or missing write permissions.`);
    }
    if (status === 404) {
      throw new Error(`Branch "${branch}" not found in ${repoFull} when trying to create "${path}".`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------

export async function createPullRequest(
  repoFull: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<CreatePRResult> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  let data;
  try {
    const resp = await octokit.rest.pulls.create({
      owner,
      repo,
      head,
      base,
      title,
      body,
    });
    data = resp.data;
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = (err as { message?: string }).message ?? '';
    if (status === 422 && message.includes('pull request already exists')) {
      throw new Error(`A PR already exists for branch "${head}". Close or merge the existing PR first.`);
    }
    if (status === 401 || status === 403) {
      throw new Error(`GitHub auth failed (${status}) creating PR in ${repoFull}. Your GITHUB_TOKEN may be expired or missing repo permissions.`);
    }
    throw new Error(`Failed to create PR in ${repoFull}: ${message || `HTTP ${status}`}`);
  }

  // Add labels if they exist (best-effort)
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: data.number,
      labels: ['greenhouse-agent', 'auto-generated'],
    });
  } catch {
    // Labels may not exist in the repo — ignore
  }

  return {
    number: data.number,
    url: data.html_url,
    headBranch: head,
  };
}

// ---------------------------------------------------------------------------
// getPullRequestStatus
// ---------------------------------------------------------------------------

export async function getPullRequestStatus(
  repoFull: string,
  prNumber: number
): Promise<PullRequestStatus> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    number: data.number,
    title: data.title,
    state: data.state as 'open' | 'closed',
    merged: data.merged ?? false,
    mergedAt: data.merged_at ?? null,
    closedAt: data.closed_at ?? null,
    url: data.html_url,
    headBranch: data.head.ref,
    reviewComments: data.review_comments,
    createdAt: data.created_at,
  };
}

// ---------------------------------------------------------------------------
// mergePullRequest
// ---------------------------------------------------------------------------

export async function mergePullRequest(
  repoFull: string,
  prNumber: number,
  commitMessage?: string
): Promise<string> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: 'squash',
    commit_message: commitMessage,
  });

  return data.sha ?? '';
}

// ---------------------------------------------------------------------------
// closePullRequest
// ---------------------------------------------------------------------------

export async function closePullRequest(
  repoFull: string,
  prNumber: number
): Promise<void> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    state: 'closed',
  });
}

// ---------------------------------------------------------------------------
// listRepoContents
// ---------------------------------------------------------------------------

export async function listRepoContents(
  repoFull: string,
  path: string,
  branch?: string
): Promise<RepoFile[]> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  const params: Record<string, string> = { owner, repo, path };
  if (branch) params.ref = branch;

  const { data } = await octokit.rest.repos.getContent(params as Parameters<typeof octokit.rest.repos.getContent>[0]);

  if (!Array.isArray(data)) {
    // Single file
    const file = data as { name: string; path: string; type: string; size?: number };
    return [{ name: file.name, path: file.path, type: file.type as 'file' | 'dir', size: file.size }];
  }

  return data.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type as 'file' | 'dir',
    size: item.size ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// getDeploymentPreviewUrl — find Vercel preview URL for a branch
// ---------------------------------------------------------------------------

export async function getDeploymentPreviewUrl(
  repoFull: string,
  branch: string
): Promise<string | null> {
  const { owner, repo } = parseRepo(repoFull);
  const octokit = getOctokit();

  try {
    const { data: deployments } = await octokit.rest.repos.listDeployments({
      owner,
      repo,
      ref: branch,
      per_page: 5,
    });

    // Find the most recent deployment with a successful status
    for (const deployment of deployments) {
      const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deployment.id,
        per_page: 1,
      });

      const latest = statuses[0];
      if (latest && latest.state === 'success' && latest.environment_url) {
        return latest.environment_url;
      }
    }
  } catch {
    // GitHub Deployments API may not be available for all repos
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildBranchName  — greenhouse/agent/{change-type}/{slug}-{ts}
// ---------------------------------------------------------------------------

export function buildBranchName(changeType: string, description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const ts = Date.now();
  return `greenhouse/agent/${changeType}/${slug}-${ts}`;
}

// ---------------------------------------------------------------------------
// buildPRBody
// ---------------------------------------------------------------------------

export function buildPRBody(opts: {
  hypothesis: string;
  description: string;
  expectedImpact: string;
  changeType: string;
  filePath: string;
  variantSlug?: string;
  changeId: string;
  appUrl?: string;
}): string {
  const dashboardUrl = opts.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000';

  return `## 🌱 Greenhouse Agent Change

**Hypothesis:** ${opts.hypothesis}

**Change Type:** \`${opts.changeType}\`
**File:** \`${opts.filePath}\`
${opts.variantSlug ? `**Variant:** \`${opts.variantSlug}\`` : ''}

---

### Expected Impact
${opts.expectedImpact}

---

### Description
${opts.description}

---

> 🤖 This PR was automatically generated by the [Greenhouse Growth Expert](${dashboardUrl}/dashboard/chat).
> Review in the [Greenhouse Dashboard](${dashboardUrl}/dashboard/pull-requests).
> Change ID: \`${opts.changeId}\`

**⚠️ This is an auto-generated change. Please review carefully before merging.**`;
}
