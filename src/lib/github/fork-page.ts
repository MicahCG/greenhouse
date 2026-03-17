import { db } from '@/lib/db';
import { variants, verticals, agent_changes, variant_versions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getFileContent,
  createBranch,
  createFile,
  createPullRequest,
  buildBranchName,
  buildPRBody,
} from '@/lib/github/client';
import { resolveRepo, isRepoKey } from '@/lib/github/permissions';

export interface ForkPageInput {
  repoKey: 'greenhouse' | 'popcorn';
  sourcePath: string;
  newRoute: string;
  textReplacements: Array<{ find: string; replace: string }>;
  verticalId: string;
  hypothesis: string;
  description: string;
  changedBy: 'user' | 'agent';
}

export interface ForkPageResult {
  success: true;
  pr_number: number;
  pr_url: string;
  branch: string;
  source_file: string;
  new_file: string;
  new_route: string;
  deployed_url: string;
  variant_id: string;
  variant_slug: string;
  change_id: string;
  replacements_applied: string[];
  copied_siblings: string[];
  message: string;
}

export async function forkPage(input: ForkPageInput): Promise<ForkPageResult> {
  const {
    repoKey,
    sourcePath,
    hypothesis,
    description,
    verticalId,
    changedBy,
  } = input;
  const newRoute = input.newRoute.replace(/^\//, '');
  const replacements = input.textReplacements ?? [];

  if (!isRepoKey(repoKey)) {
    throw new Error('repo must be "greenhouse" or "popcorn"');
  }

  const repoFull = resolveRepo(repoKey);

  // 1. Read source file
  const file = await getFileContent(repoFull, sourcePath);

  // 2. Apply text replacements
  let newContent = file.content;
  const appliedReplacements: string[] = [];
  for (const { find, replace } of replacements) {
    if (newContent.includes(find)) {
      newContent = newContent.replaceAll(find, replace);
      appliedReplacements.push(`"${find.slice(0, 50)}" \u2192 "${replace.slice(0, 50)}"`);
    } else {
      appliedReplacements.push(`\u26A0 "${find.slice(0, 50)}" not found in source`);
    }
  }

  // 2b. Safety check: detect if replacements changed any @/ import paths
  // This would break the Vercel build if the new paths don't exist
  const originalImports = new Set(
    (file.content.match(/@\/[^'"]+/g) ?? []).map((m) => m)
  );
  const newImports = new Set(
    (newContent.match(/@\/[^'"]+/g) ?? []).map((m) => m)
  );
  const brokenImports: string[] = [];
  for (const imp of newImports) {
    if (!originalImports.has(imp)) {
      brokenImports.push(imp);
    }
  }
  if (brokenImports.length > 0) {
    throw new Error(
      `Text replacements changed @/ import paths to files that may not exist: ${brokenImports.join(', ')}. ` +
      `This will break the Vercel build. Don't change import paths — only change text content, string literals, and prop values.`
    );
  }

  // 3. Determine destination path
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
  const parentDir = sourceDir.substring(0, sourceDir.lastIndexOf('/'));
  const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
  const destPath = `${parentDir}/${newRoute}/${fileName}`;
  const destDir = `${parentDir}/${newRoute}`;

  // 3b. Detect relative imports that need to be copied (./file.css, ./component.tsx, etc.)
  const relativeImportPattern = /(?:import|from)\s+['"]\.\/([^'"]+)['"]/g;
  const relativeImports: string[] = [];
  let importMatch;
  while ((importMatch = relativeImportPattern.exec(newContent)) !== null) {
    relativeImports.push(importMatch[1]);
  }
  // Also check CSS imports: import './file.css'
  const cssImportPattern = /import\s+['"]\.\/([^'"]+\.css)['"]/g;
  while ((importMatch = cssImportPattern.exec(file.content)) !== null) {
    if (!relativeImports.includes(importMatch[1])) {
      relativeImports.push(importMatch[1]);
    }
  }

  // 4. Create branch
  const branchName = buildBranchName('variant', `fork-${newRoute}`);
  await createBranch(repoFull, branchName);

  // 5. Commit main page file
  const commitMessage = `[Greenhouse] Fork ${sourcePath} \u2192 ${destPath}\n\n${description}`;
  await createFile(repoFull, destPath, newContent, commitMessage, branchName);

  // 5b. Copy sibling files (relative imports like CSS, local components)
  const copiedSiblings: string[] = [];
  for (const relImport of relativeImports) {
    // Add common extensions if the import doesn't have one
    const candidates = relImport.includes('.')
      ? [relImport]
      : [`${relImport}.tsx`, `${relImport}.ts`, `${relImport}.jsx`, `${relImport}.js`];

    for (const candidate of candidates) {
      const siblingSource = `${sourceDir}/${candidate}`;
      const siblingDest = `${destDir}/${candidate}`;
      try {
        const siblingFile = await getFileContent(repoFull, siblingSource);
        // Apply text replacements to sibling files too
        let siblingContent = siblingFile.content;
        for (const { find, replace } of replacements) {
          if (siblingContent.includes(find)) {
            siblingContent = siblingContent.replaceAll(find, replace);
          }
        }
        await createFile(repoFull, siblingDest, siblingContent, `[Greenhouse] Copy ${candidate} for /${newRoute}`, branchName);
        copiedSiblings.push(candidate);
        break; // found the file, skip other extension candidates
      } catch {
        // File doesn't exist at this path — try next candidate or skip
      }
    }
  }

  // 6. Create PR
  const prTitle = `[Greenhouse] New variant: /${newRoute}`;
  const prBody = buildPRBody({
    hypothesis,
    description,
    expectedImpact: hypothesis,
    changeType: 'variant',
    filePath: destPath,
    changeId: 'pending',
  });
  const prResult = await createPullRequest(repoFull, branchName, 'main', prTitle, prBody);

  // 7. Verify vertical
  const [vertical] = await db
    .select()
    .from(verticals)
    .where(eq(verticals.id, verticalId))
    .limit(1);

  if (!vertical) {
    throw new Error(`Vertical not found: ${verticalId}. PR was still created at ${prResult.url}`);
  }

  // 8. Register variant — derive domain from the vertical's source_url or env
  let domain = process.env.NEXT_PUBLIC_POPCORN_URL ?? '';
  if (!domain && vertical.source_url) {
    try {
      const u = new URL(vertical.source_url);
      domain = u.origin; // e.g. "https://www.popcorn.co"
    } catch { /* ignore */ }
  }
  const deployedUrl = domain ? `${domain}/${newRoute}` : `/${newRoute}`;

  const [newVariant] = await db
    .insert(variants)
    .values({
      vertical_id: verticalId,
      slug: newRoute.replace(/[^a-z0-9-]/g, '-'),
      variant_type: 'external_url',
      external_url: deployedUrl,
      config: {
        label: `/${newRoute} (PR #${prResult.number})`,
        external_url: deployedUrl,
        template: 'external',
      },
      traffic_weight: 0,
      version: 1,
      status: 'paused',
    })
    .returning();

  await db.insert(variant_versions).values({
    variant_id: newVariant.id,
    version: 1,
    config: newVariant.config as Record<string, unknown>,
    changed_by: changedBy,
    change_description: `Forked from ${sourcePath}`,
  });

  // 9. Audit record
  const [changeRecord] = await db
    .insert(agent_changes)
    .values({
      project_id: vertical.project_id,
      variant_id: newVariant.id,
      hypothesis,
      description,
      change_type: 'code',
      change_source: 'code',
      file_path: destPath,
      github_repo: repoKey,
      pr_url: prResult.url,
      pr_number: prResult.number,
      branch_name: branchName,
      diff_summary: JSON.stringify({
        action: 'fork_page',
        source: sourcePath,
        destination: destPath,
        replacements: appliedReplacements,
      }),
      previous_variant_version: 0,
      verdict: 'proposed',
      min_sample_size: 500,
      samples_collected: 0,
    })
    .returning();

  return {
    success: true,
    pr_number: prResult.number,
    pr_url: prResult.url,
    branch: branchName,
    source_file: sourcePath,
    new_file: destPath,
    new_route: `/${newRoute}`,
    deployed_url: deployedUrl,
    variant_id: newVariant.id,
    variant_slug: newVariant.slug,
    change_id: changeRecord.id,
    replacements_applied: appliedReplacements,
    copied_siblings: copiedSiblings,
    message: `Done! PR #${prResult.number} created (${1 + copiedSiblings.length} files). New route /${newRoute} will go live after merge. Variant "${newVariant.slug}" is tracking it in Greenhouse (paused until merge).`,
  };
}
