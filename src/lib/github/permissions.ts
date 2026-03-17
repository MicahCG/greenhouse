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

export function resolveRepo(key: RepoKey): string {
  if (key === 'greenhouse') {
    const repo = process.env.GITHUB_GREENHOUSE_REPO;
    if (!repo) throw new Error('GITHUB_GREENHOUSE_REPO env var is not set');
    return repo;
  }
  if (key === 'popcorn') {
    const repo = process.env.GITHUB_POPCORN_REPO;
    if (!repo) throw new Error('GITHUB_POPCORN_REPO env var is not set');
    return repo;
  }
  throw new Error(`Unknown repo key: "${key}"`);
}

export function isRepoKey(value: unknown): value is RepoKey {
  return value === 'greenhouse' || value === 'popcorn';
}
