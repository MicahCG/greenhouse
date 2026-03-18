// ---------------------------------------------------------------------------
// Path permission rules for agent GitHub write access
// ---------------------------------------------------------------------------

export type RepoKey = 'greenhouse' | 'popcorn';

// These path prefixes are ALLOWED for agent write access
const ALLOWED_WRITE_PATHS: Record<RepoKey, string[]> = {
  greenhouse: [
    'src/components/landing-pages/',
    'src/app/lp/',
    'src/components/templates/',
    'src/components/sections/',
  ],
  popcorn: [
    'app/',
    'components/',
    'lib/',
    'hooks/',
    'services/',
    'types/',
    'state/',
    'public/',
  ],
};

// These paths are ALWAYS BLOCKED (even if they match an allowed prefix)
const BLOCKED_PATHS = [
  '.env',
  '.env.local',
  '.env.production',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'next.config',
  'drizzle.config',
  'middleware.ts',
  '.github/',
  'Dockerfile',
  'docker-compose',
];

// Extensions that are never allowed to be written
const BLOCKED_EXTENSIONS = ['.env', '.key', '.pem', '.cert', '.secret'];

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

export function validateFileAccess(
  repo: RepoKey,
  filePath: string,
  operation: 'read' | 'write'
): PermissionResult {
  const normalizedPath = filePath.replace(/^\//, ''); // strip leading slash

  // Read is always allowed
  if (operation === 'read') {
    // Check blocked extensions for reads too
    const ext = getExtension(normalizedPath);
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return { allowed: false, reason: `Files with extension "${ext}" cannot be read` };
    }
    return { allowed: true, reason: 'Read access granted' };
  }

  // Check blocked extensions
  const ext = getExtension(normalizedPath);
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { allowed: false, reason: `Files with extension "${ext}" are blocked` };
  }

  // Check blocked paths (exact matches and prefixes)
  for (const blocked of BLOCKED_PATHS) {
    if (
      normalizedPath === blocked ||
      normalizedPath.startsWith(blocked) ||
      normalizedPath.includes(blocked)
    ) {
      return {
        allowed: false,
        reason: `Path "${normalizedPath}" matches blocked pattern "${blocked}". Agent cannot modify infrastructure, config, or credential files.`,
      };
    }
  }

  // Check if path is within an allowed write directory for this repo
  const allowedPaths = ALLOWED_WRITE_PATHS[repo] ?? [];
  const isAllowed = allowedPaths.some((allowed) => normalizedPath.startsWith(allowed));

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Path "${normalizedPath}" is outside the allowed write directories for the "${repo}" repo. Allowed paths: ${allowedPaths.join(', ')}`,
    };
  }

  return { allowed: true, reason: 'Write access granted' };
}

function getExtension(path: string): string {
  const parts = path.split('.');
  if (parts.length < 2) return '';
  return '.' + parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Resolve repo full name from key
// ---------------------------------------------------------------------------

/** Normalize a repo value to "owner/repo" format, stripping any URL prefix. */
function normalizeRepo(value: string): string {
  // Handle full GitHub URLs like "https://github.com/owner/repo"
  try {
    const url = new URL(value);
    if (url.hostname === 'github.com') {
      // pathname is "/owner/repo" or "/owner/repo/"
      return url.pathname.replace(/^\//, '').replace(/\/$/, '');
    }
  } catch {
    // Not a URL — treat as owner/repo string
  }
  return value;
}

export function resolveRepo(key: RepoKey): string {
  if (key === 'greenhouse') {
    const repo = process.env.GITHUB_GREENHOUSE_REPO;
    if (!repo) throw new Error('GITHUB_GREENHOUSE_REPO env var is not set');
    return normalizeRepo(repo);
  }
  if (key === 'popcorn') {
    const repo = process.env.GITHUB_POPCORN_REPO;
    if (!repo) throw new Error('GITHUB_POPCORN_REPO env var is not set');
    return normalizeRepo(repo);
  }
  throw new Error(`Unknown repo key: "${key}"`);
}

export function isRepoKey(value: unknown): value is RepoKey {
  return value === 'greenhouse' || value === 'popcorn';
}

/**
 * Normalize a source file path that may be a full GitHub URL.
 * Strips "https://github.com/owner/repo/tree/branch/" prefix.
 * If the path looks like a directory (no file extension), appends "/page.tsx".
 */
export function normalizeSourcePath(value: string): string {
  let path = value;

  // Strip full GitHub URL: https://github.com/owner/repo/tree/branch/actual/path
  try {
    const url = new URL(value);
    if (url.hostname === 'github.com') {
      // pathname: /owner/repo/tree/branch/actual/path
      const parts = url.pathname.replace(/^\//, '').split('/');
      // Skip owner/repo/tree/branch (4 segments)
      if (parts.length > 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
        path = parts.slice(4).join('/');
      }
    }
  } catch {
    // Not a URL
  }

  // Strip leading slash
  path = path.replace(/^\//, '');

  // If path looks like a directory (no file extension), append /page.tsx
  const lastSegment = path.split('/').pop() ?? '';
  if (!lastSegment.includes('.')) {
    path = path.replace(/\/$/, '') + '/page.tsx';
  }

  return path;
}
