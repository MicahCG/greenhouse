import { db } from '@/lib/db';
import { variants, verticals, agent_changes, projects, ad_spend_records, variant_versions } from '@/lib/db/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { rebalanceWeights } from '@/lib/experiments/traffic';
import {
  getProjectOverview,
  getVerticalMetrics,
  getVariantTimeSeries,
  getVariantTrafficSources,
  getFunnelData,
  getGrowthMetrics,
} from '@/lib/dashboard/queries';
import {
  calculateSignificance,
  calculateMinSampleSize,
} from '@/lib/stats/significance';
import { fetchPageContent } from '@/lib/agent/page-ingest';
import { extractSourceContent } from '@/lib/agent/source-extractor';
import { forkPage } from '@/lib/github/fork-page';
import {
  getFileContent,
  createBranch,
  createFile,
  updateFile,
  createPullRequest,
  getPullRequestStatus,
  listRepoContents,
  buildBranchName,
  buildPRBody,
} from '@/lib/github/client';
import {
  validateFileAccess,
  resolveRepo,
  isRepoKey,
} from '@/lib/github/permissions';

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool format)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS = [
  {
    name: 'get_experiment_overview',
    description:
      'Get a high-level overview of a project including all verticals, visitor counts, and conversion rates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID to fetch overview for',
        },
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_variant_performance',
    description:
      'Get detailed performance data for a specific variant including time series and traffic sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: {
          type: 'string',
          description: 'The variant UUID',
        },
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
        },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'compare_variants',
    description:
      'Compare all variants in a vertical with statistical significance data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        vertical_id: {
          type: 'string',
          description: 'The vertical UUID',
        },
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
        },
      },
      required: ['vertical_id'],
    },
  },
  {
    name: 'get_funnel_data',
    description:
      'Get conversion funnel data for a project showing drop-off at each stage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_growth_metrics',
    description:
      'Get the three primary growth KPIs as daily time series: homepage anonymous visitors (Viewed event where path="/" and user_id is not set, metric=uniques), new registrations (User Signed Up, uniques), and credit purchases (Credits Purchased, totals). This is the same data shown on the Analytics dashboard. Use this when the user asks about visitors, registrations, signups, purchases, or overall growth trends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_variant_config',
    description:
      'Get the full creative content and config for a specific variant: headline, subheadline, body copy, CTA text and URL, hero image URL, social proof, template type, and SEO meta fields. Use this when the user asks about what a variant says, its messaging, copy, design, or wants to compare creative content across variants. Variant IDs are listed in the system prompt context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: {
          type: 'string',
          description: 'The variant UUID',
        },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_change_history',
    description:
      'Get the history of agent-proposed changes, optionally filtered by variant or project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: {
          type: 'string',
          description: 'Filter by variant UUID (optional)',
        },
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max number of records to return (default: 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'propose_variant_change',
    description:
      'Propose a config change to a variant. The change will be stored as "proposed" and requires human approval before being applied. Only call this after stating a hypothesis and referencing specific data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: {
          type: 'string',
          description: 'The variant UUID to modify',
        },
        hypothesis: {
          type: 'string',
          description: 'The specific hypothesis this change is testing',
        },
        changes: {
          type: 'object',
          description:
            'Partial VariantConfig with new values. Valid keys: headline, subheadline, body_copy, cta_primary.text, cta_secondary.text, hero_image. Do NOT include template or tracking fields.',
        },
        expected_impact: {
          type: 'string',
          description: 'Expected impact on conversion rate and why',
        },
        change_type: {
          type: 'string',
          enum: ['copy', 'layout', 'style', 'cta', 'image'],
          description: 'Category of change',
        },
      },
      required: ['variant_id', 'hypothesis', 'changes', 'expected_impact', 'change_type'],
    },
  },
  {
    name: 'update_variant_status',
    description:
      'Update the status of a variant (e.g. pause or kill an underperforming variant).',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: {
          type: 'string',
          description: 'The variant UUID',
        },
        new_status: {
          type: 'string',
          enum: ['active', 'paused', 'killed'],
          description: 'New status for the variant',
        },
        reason: {
          type: 'string',
          description: 'Reason for the status change',
        },
      },
      required: ['variant_id', 'new_status', 'reason'],
    },
  },
  {
    name: 'get_ad_spend_overview',
    description:
      'Get an overview of ad spend for a project including total spend, active campaigns, top platform, and CPA by vertical.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID to fetch ad spend overview for',
        },
        date_range_days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_campaign_performance',
    description:
      'Get campaign-level performance from ad spend records for a project, optionally filtered by platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
        platform: {
          type: 'string',
          enum: ['google'],
          description: 'Filter by platform (optional)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_budget_recommendations',
    description:
      'Get budget recommendations for a project based on CPA performance — returns campaigns ranked by CPA with increase/decrease suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'calculate_required_sample',
    description:
      'Calculate statistical significance and required sample size given current visitor and conversion counts for control and variant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        current_visitors_control: {
          type: 'number',
          description: 'Current visitor count for control',
        },
        current_conversions_control: {
          type: 'number',
          description: 'Current conversion count for control',
        },
        current_visitors_variant: {
          type: 'number',
          description: 'Current visitor count for variant',
        },
        current_conversions_variant: {
          type: 'number',
          description: 'Current conversion count for variant',
        },
        minimum_detectable_effect: {
          type: 'number',
          description: 'Minimum detectable effect as absolute rate difference (default: 0.05)',
        },
      },
      required: [
        'current_visitors_control',
        'current_conversions_control',
        'current_visitors_variant',
        'current_conversions_variant',
      ],
    },
  },
  {
    name: 'create_vertical',
    description:
      'Create a new vertical (page experiment group) within a project. A vertical represents a specific page being tested. Set the source_url and source_file to link it to the actual page in the codebase. Use this BEFORE creating variants — the vertical must exist first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID to create the vertical in',
        },
        name: {
          type: 'string',
          description: 'Display name (e.g. "Small Business Owners")',
        },
        slug: {
          type: 'string',
          description: 'URL slug (e.g. "smb"). Auto-generated from name if omitted.',
        },
        description: {
          type: 'string',
          description: 'What audience or page this vertical targets',
        },
        source_url: {
          type: 'string',
          description: 'The live page URL (e.g. "https://www.popcorn.co/faceless")',
        },
        source_file: {
          type: 'string',
          description: 'GitHub file path (e.g. "app/(landing)/faceless/page.tsx")',
        },
      },
      required: ['project_id', 'name'],
    },
  },
  {
    name: 'fetch_page',
    description:
      'Fetch a live URL and extract its content: title, headings, body text, CTAs/buttons, links, images, and meta tags. Use this FIRST when a user provides a URL and wants to create variants or optimize an existing page. This tells you what the page currently looks like so you can propose meaningful variations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch and analyze (e.g. "https://www.popcorn.co/credits")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_page_content',
    description:
      'Read a source file from the repo and extract all visible text content (headings, paragraphs, buttons, links, string props). Returns the text elements that actually appear on the page with line numbers and context. Use this BEFORE proposing text replacements so you know exactly what strings to target. Much more useful than read_file for understanding page content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          enum: ['greenhouse', 'popcorn'],
          description: 'Which repository',
        },
        path: {
          type: 'string',
          description: 'File path (e.g. "app/(sidebar)/credits/page.tsx")',
        },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'show_draft_preview',
    description:
      'Show the user a visual draft preview of proposed text replacements before pushing to GitHub. Call this after discussing changes to give the user a chance to review all accumulated changes as a visual diff. The user can then approve (push), modify, or add more changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        vertical_id: {
          type: 'string',
          description: 'The vertical this variant belongs to',
        },
        source_path: {
          type: 'string',
          description: 'Source file being forked',
        },
        new_route: {
          type: 'string',
          description: 'New route name (e.g. "/smb")',
        },
        hypothesis: {
          type: 'string',
          description: 'What this variant tests',
        },
        replacements: {
          type: 'array',
          description: 'All proposed text replacements',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              context: { type: 'string', description: 'What element (e.g. "h1 heading")' },
            },
            required: ['find', 'replace'],
          },
        },
      },
      required: ['vertical_id', 'source_path', 'new_route', 'hypothesis', 'replacements'],
    },
  },
  {
    name: 'create_variant',
    description:
      'Create a new variant in an existing vertical. ALWAYS use variant_type "external_url" — this registers an existing Popcorn page by URL for tracking in Greenhouse. Use this when the user asks to create a new variant, add a URL to track, or set up an A/B test. The external_url is required.',
    input_schema: {
      type: 'object' as const,
      properties: {
        vertical_id: {
          type: 'string',
          description: 'The vertical UUID to add the variant to',
        },
        variant_type: {
          type: 'string',
          enum: ['external_url'],
          description: 'Always "external_url". Registers an existing page by URL for tracking.',
        },
        hypothesis: {
          type: 'string',
          description: 'The specific hypothesis this new variant is testing, or description of what this variant represents',
        },
        config: {
          type: 'object',
          description:
            'For template variants: full VariantConfig object with headline, subheadline, body_copy, cta_primary ({text, action}), template ("hero-centered" or "hero-split"), meta_title, meta_description. For external_url variants: omit this or pass null.',
        },
        external_url: {
          type: 'string',
          description: 'For external_url variants: the target page URL (e.g. "https://www.popcorn.co/credits"). Required when variant_type is "external_url".',
        },
        label: {
          type: 'string',
          description: 'For external_url variants: human-readable label (e.g. "Credit Store — Current"). Optional, defaults to the URL hostname.',
        },
        expected_impact: {
          type: 'string',
          description: 'Expected impact on conversion rate and why',
        },
      },
      required: ['vertical_id', 'hypothesis', 'expected_impact'],
    },
  },
  {
    name: 'fork_page',
    description:
      'Duplicate an existing page in the Popcorn repo as a new route with copy/text changes. This is the PRIMARY tool for creating page variants. It does everything in one step: reads the source file, duplicates it to a new route, applies your text substitutions, creates a GitHub branch + PR, and registers the variant in Greenhouse for tracking. After the PR is merged, the new route goes live and Greenhouse tracks it automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          enum: ['greenhouse', 'popcorn'],
          description: 'Which repository the page lives in',
        },
        source_path: {
          type: 'string',
          description: 'Path to the existing page file (e.g. "app/(sidebar)/credits/page.tsx")',
        },
        new_route: {
          type: 'string',
          description: 'The new route path (e.g. "/credits2"). The file will be created at the corresponding location in the repo.',
        },
        text_replacements: {
          type: 'array',
          description: 'Array of {find, replace} objects. Each pair replaces exact text in the source file. Use this for copy changes, headline swaps, CTA text, etc.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact text to find in the source' },
              replace: { type: 'string', description: 'Text to replace it with' },
            },
            required: ['find', 'replace'],
          },
        },
        vertical_id: {
          type: 'string',
          description: 'The vertical UUID to add the new variant to',
        },
        hypothesis: {
          type: 'string',
          description: 'What this variant is testing',
        },
        description: {
          type: 'string',
          description: 'Human-readable summary of what changed',
        },
      },
      required: ['repo', 'source_path', 'new_route', 'vertical_id', 'hypothesis', 'description'],
    },
  },
  // ---------------------------------------------------------------------------
  // GitHub tools
  // ---------------------------------------------------------------------------
  {
    name: 'read_file',
    description:
      'Read a file from the Greenhouse or Popcorn repository. Use this to understand the current code before proposing changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          enum: ['greenhouse', 'popcorn'],
          description: 'Which repository to read from',
        },
        path: {
          type: 'string',
          description: 'File path relative to repo root (e.g. "src/components/landing-pages/hero.tsx")',
        },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'list_repo_files',
    description:
      'List files in a directory of the Greenhouse or Popcorn repository. Use this to explore the repo structure before reading or modifying files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          enum: ['greenhouse', 'popcorn'],
          description: 'Which repository to explore',
        },
        path: {
          type: 'string',
          description: 'Directory path relative to repo root (e.g. "src/components/landing-pages")',
        },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'propose_code_change',
    description:
      'Propose a code-level change by creating or modifying a file in the Greenhouse or Popcorn repository. Creates a GitHub branch and PR for human review. Supports both modifying existing files AND creating new files (e.g. duplicating a page as a new route). The change does NOT deploy immediately — a human must review and merge the PR. After the PR is created, Vercel will generate a deploy preview URL automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          enum: ['greenhouse', 'popcorn'],
          description: 'Which repository to modify',
        },
        file_path: {
          type: 'string',
          description: 'File path relative to repo root. For new files, this is where the file will be created (e.g. "src/app/credits-v2/page.tsx")',
        },
        new_content: {
          type: 'string',
          description: 'The complete file content (full file, not a diff)',
        },
        is_new_file: {
          type: 'boolean',
          description: 'Set to true if creating a new file (not modifying an existing one). Default: false.',
        },
        hypothesis: {
          type: 'string',
          description: 'The specific hypothesis this change is testing',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what changed and why',
        },
        expected_impact: {
          type: 'string',
          description: 'Expected impact on conversion rate and why',
        },
        change_type: {
          type: 'string',
          enum: ['template', 'layout', 'style', 'copy', 'cta', 'image', 'code'],
          description: 'Category of change',
        },
        variant_id: {
          type: 'string',
          description: 'The variant UUID this change is associated with (optional)',
        },
      },
      required: ['repo', 'file_path', 'new_content', 'hypothesis', 'description', 'expected_impact', 'change_type'],
    },
  },
  {
    name: 'get_pr_status',
    description:
      'Get the current status of a GitHub PR created by the agent. Returns whether it is open, merged, or closed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        change_id: {
          type: 'string',
          description: 'The agent_change UUID (from a previous propose_code_change call)',
        },
      },
      required: ['change_id'],
    },
  },
  {
    name: 'generate_wireframe',
    description:
      'Generate an ASCII wireframe preview of a page. Use this after reading a source file with extract_page_content or read_file to show the user a visual representation of the page structure. The agent builds the ASCII art from its understanding of the source code — the tool formats and displays it. Call this to preview pages that cannot be shown in an iframe (e.g. auth-protected pages), and to show before/after comparisons when proposing text changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Page title (e.g. "Credits Page", "Pricing")',
        },
        sections: {
          type: 'array',
          description: 'Ordered list of page sections, each with a type and ASCII art content',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['hero', 'cards', 'pricing', 'table', 'cta', 'section', 'nav', 'footer'],
                description: 'Section type',
              },
              content: {
                type: 'string',
                description: 'ASCII art for this section using box-drawing characters (+----|). Include real text content from the source code.',
              },
            },
            required: ['type', 'content'],
          },
        },
        source_path: {
          type: 'string',
          description: 'Source file path this wireframe represents',
        },
        variant_label: {
          type: 'string',
          description: 'Label for this wireframe (e.g. "CURRENT", "VARIANT: /credits2"). Useful for before/after comparisons.',
        },
      },
      required: ['title', 'sections', 'source_path'],
    },
  },
];

// ---------------------------------------------------------------------------
// Valid editable config keys
// ---------------------------------------------------------------------------

const VALID_CHANGE_KEYS = new Set([
  'headline',
  'subheadline',
  'body_copy',
  'cta_primary.text',
  'cta_secondary.text',
  'hero_image',
]);

function validateChanges(changes: Record<string, unknown>): string | null {
  for (const key of Object.keys(changes)) {
    if (!VALID_CHANGE_KEYS.has(key)) {
      return `Invalid change key: "${key}". Only editable fields are: ${Array.from(VALID_CHANGE_KEYS).join(', ')}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'get_experiment_overview': {
        const projectId = input.project_id as string;
        const days = (input.date_range_days as number) ?? 7;
        const result = await getProjectOverview(projectId);
        return JSON.stringify({ ...result, date_range_days: days });
      }

      case 'get_variant_performance': {
        const variantId = input.variant_id as string;
        const days = (input.date_range_days as number) ?? 30;
        const [timeSeries, trafficSources] = await Promise.all([
          getVariantTimeSeries(variantId, days),
          getVariantTrafficSources(variantId, days),
        ]);
        const totalVisitors = timeSeries.reduce((s, p) => s + p.visitors, 0);
        const totalClicks = timeSeries.reduce((s, p) => s + p.clicks, 0);
        const convRate = totalVisitors > 0 ? totalClicks / totalVisitors : 0;
        return JSON.stringify({
          variant_id: variantId,
          date_range_days: days,
          summary: { totalVisitors, totalClicks, convRate },
          timeSeries,
          trafficSources,
        });
      }

      case 'compare_variants': {
        const verticalId = input.vertical_id as string;
        const days = (input.date_range_days as number) ?? 30;
        const result = await getVerticalMetrics(verticalId, days);
        return JSON.stringify({ ...result, date_range_days: days });
      }

      case 'get_funnel_data': {
        const projectId = input.project_id as string;
        const days = (input.date_range_days as number) ?? 30;
        const result = await getFunnelData(projectId, days);
        return JSON.stringify({ ...result, date_range_days: days });
      }

      case 'get_growth_metrics': {
        const days = (input.date_range_days as number) ?? 30;
        const result = await getGrowthMetrics(days);
        // Summarize series into daily totals for readability + include last 7 days detail
        const last7 = (series: Array<{ date: string; value: number }>) =>
          series.slice(-7).map((p) => ({ date: p.date, count: p.value }));
        return JSON.stringify({
          date_range_days: days,
          visitors: {
            total: result.visitorsTotal,
            event: 'Viewed',
            filters: 'path="/" AND user_id is not set',
            metric: 'uniques',
            note: 'Anonymous homepage visitors only (pre-registration)',
            last7Days: last7(result.visitorsDaily),
          },
          registrations: {
            total: result.registrationsTotal,
            event: 'User Signed Up',
            last7Days: last7(result.registrationsDaily),
          },
          credit_purchases: {
            total: result.purchasesTotal,
            event: 'Credits Purchased',
            metric: 'totals',
            last7Days: last7(result.purchasesDaily),
          },
        });
      }

      case 'get_variant_config': {
        const variantId = input.variant_id as string;
        const [variant] = await db
          .select()
          .from(variants)
          .where(eq(variants.id, variantId))
          .limit(1);
        if (!variant) return JSON.stringify({ error: 'Variant not found' });

        const [vertical] = await db
          .select()
          .from(verticals)
          .where(eq(verticals.id, variant.vertical_id))
          .limit(1);

        return JSON.stringify({
          id: variant.id,
          slug: variant.slug,
          version: variant.version,
          status: variant.status,
          variant_type: variant.variant_type,
          external_url: variant.external_url,
          traffic_weight: variant.traffic_weight,
          config: variant.config,
          vertical_name: vertical?.name ?? 'Unknown',
          vertical_slug: vertical?.slug ?? '',
        });
      }

      case 'get_change_history': {
        const variantId = input.variant_id as string | undefined;
        const projectId = input.project_id as string | undefined;
        const limit = (input.limit as number) ?? 10;

        let query = db.select().from(agent_changes);

        let rows;
        if (variantId && projectId) {
          rows = await query
            .where(and(
              eq(agent_changes.variant_id, variantId),
              eq(agent_changes.project_id, projectId)
            ))
            .limit(limit);
        } else if (variantId) {
          rows = await query
            .where(eq(agent_changes.variant_id, variantId))
            .limit(limit);
        } else if (projectId) {
          rows = await query
            .where(eq(agent_changes.project_id, projectId))
            .limit(limit);
        } else {
          rows = await query.limit(limit);
        }

        return JSON.stringify({ changes: rows, count: rows.length });
      }

      case 'propose_variant_change': {
        const variantId = input.variant_id as string;
        const hypothesis = input.hypothesis as string;
        const changes = input.changes as Record<string, unknown>;
        const expectedImpact = input.expected_impact as string;
        const changeType = input.change_type as string;

        // Validate change keys
        const validationError = validateChanges(changes);
        if (validationError) {
          return JSON.stringify({ error: validationError });
        }

        // Fetch variant + project_id
        const [variant] = await db
          .select()
          .from(variants)
          .where(eq(variants.id, variantId))
          .limit(1);
        if (!variant) return JSON.stringify({ error: 'Variant not found' });

        // Reject external URL variants — config changes don't apply
        if (variant.variant_type === 'external_url') {
          return JSON.stringify({
            error: 'Cannot modify config of an external URL variant. External URL variants point to existing pages and their content is managed outside Greenhouse. You can only create new template variants or modify existing template variants.',
          });
        }

        const [vertical] = await db
          .select()
          .from(verticals)
          .where(eq(verticals.id, variant.vertical_id))
          .limit(1);
        if (!vertical) return JSON.stringify({ error: 'Vertical not found' });

        const diffSummary = JSON.stringify({
          proposed_changes: changes,
          expected_impact: expectedImpact,
        });

        const config = variant.config as Record<string, unknown>;
        const currentConfigSummary = {
          headline: config.headline,
          subheadline: config.subheadline,
          cta_primary_text: (config.cta_primary as Record<string, unknown>)?.text,
        };

        const [inserted] = await db
          .insert(agent_changes)
          .values({
            project_id: vertical.project_id,
            variant_id: variantId,
            hypothesis,
            description: expectedImpact,
            change_type: changeType,
            diff_summary: diffSummary,
            previous_variant_version: variant.version,
            verdict: 'proposed',
            min_sample_size: 500,
            samples_collected: 0,
          })
          .returning();

        return JSON.stringify({
          change_id: inserted.id,
          hypothesis,
          changes,
          expected_impact: expectedImpact,
          current_config: config,
          current_config_summary: currentConfigSummary,
          status: 'proposed',
          message: 'Change proposal created. Awaiting human approval.',
        });
      }

      case 'update_variant_status': {
        const variantId = input.variant_id as string;
        const newStatus = input.new_status as string;
        const reason = input.reason as string;

        await db
          .update(variants)
          .set({ status: newStatus, updated_at: new Date() })
          .where(eq(variants.id, variantId));

        return JSON.stringify({
          variant_id: variantId,
          new_status: newStatus,
          reason,
          updated: true,
        });
      }

      case 'extract_page_content': {
        const repoKey = input.repo as string;
        const filePath = input.path as string;

        if (!isRepoKey(repoKey)) {
          return JSON.stringify({ error: 'repo must be "greenhouse" or "popcorn"' });
        }

        try {
          const repoFull = resolveRepo(repoKey);
          const file = await getFileContent(repoFull, filePath);
          const result = extractSourceContent(file.content, filePath);

          return JSON.stringify({
            file: filePath,
            total_lines: result.totalLines,
            text_count: result.texts.length,
            texts: result.texts,
            imports: result.imports.filter((i) => !i.path.startsWith('react')).slice(0, 20),
            tip: 'Use these text values in fork_page text_replacements. The "find" value must match EXACTLY.',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: `Failed to extract content: ${msg}` });
        }
      }

      case 'show_draft_preview': {
        // Display-only tool — returns input as-is to trigger DraftCard rendering in chat
        return JSON.stringify({
          type: 'draft_preview',
          vertical_id: input.vertical_id,
          source_path: input.source_path,
          new_route: input.new_route,
          hypothesis: input.hypothesis,
          replacements: input.replacements,
          message: 'Draft preview shown. User can approve to push, or request changes.',
        });
      }

      case 'create_vertical': {
        const projectId = input.project_id as string;
        const name = input.name as string;
        const description = (input.description as string) ?? '';
        const sourceUrl = input.source_url as string | undefined;
        const sourceFile = input.source_file as string | undefined;

        // Verify project exists
        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        if (!project) return JSON.stringify({ error: `Project not found: ${projectId}` });

        // Generate slug
        let slug = (input.slug as string) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Check uniqueness
        const [existing] = await db.select({ id: verticals.id }).from(verticals).where(eq(verticals.slug, slug)).limit(1);
        if (existing) {
          slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
        }

        const [vertical] = await db
          .insert(verticals)
          .values({
            project_id: projectId,
            slug,
            name,
            description,
            source_url: sourceUrl,
            source_file: sourceFile,
            traffic_split_strategy: 'equal',
          })
          .returning();

        return JSON.stringify({
          vertical_id: vertical.id,
          name: vertical.name,
          slug: vertical.slug,
          source_url: vertical.source_url,
          source_file: vertical.source_file,
          project_name: project.name,
          message: `Vertical "${name}" created in ${project.name}. You can now add variants to it.`,
        });
      }

      case 'fetch_page': {
        const url = input.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });

        try {
          const content = await fetchPageContent(url);
          return JSON.stringify({
            url: content.url,
            title: content.title,
            meta_description: content.meta_description,
            headings: content.headings,
            paragraphs: content.paragraphs,
            buttons: content.buttons,
            links: content.links.slice(0, 15),
            images: content.images.slice(0, 5),
            text_preview: content.raw_text_preview.slice(0, 1500),
            tip: 'Use this content to create template variants with meaningful headlines, copy, and CTAs that match or improve on the current page.',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: `Failed to fetch page: ${message}` });
        }
      }

      case 'create_variant': {
        const verticalId = input.vertical_id as string;
        const variantType = (input.variant_type as string) ?? 'external_url';
        const hypothesis = input.hypothesis as string;
        const expectedImpact = input.expected_impact as string;

        // Fetch vertical + project
        const [vertical] = await db
          .select()
          .from(verticals)
          .where(eq(verticals.id, verticalId))
          .limit(1);
        if (!vertical) return JSON.stringify({ error: 'Vertical not found' });

        // Auto-generate slug
        const existingVariants = await db
          .select({ slug: variants.slug })
          .from(variants)
          .where(eq(variants.vertical_id, verticalId));
        const existingSlugs = new Set(existingVariants.map((v) => v.slug));
        const SLUGS = ['variant-a', 'variant-b', 'variant-c', 'variant-d', 'variant-e', 'variant-f'];
        const slug = SLUGS.find((s) => !existingSlugs.has(s)) ?? `variant-${existingVariants.length + 1}`;

        if (variantType === 'external_url') {
          // ---- External URL variant ----
          const externalUrl = input.external_url as string;
          if (!externalUrl) {
            return JSON.stringify({ error: 'external_url is required for external_url variants' });
          }

          let hostname: string;
          try {
            hostname = new URL(externalUrl).hostname;
          } catch {
            return JSON.stringify({ error: `Invalid URL: "${externalUrl}"` });
          }

          const label = (input.label as string) ?? hostname;
          const config = { label, external_url: externalUrl, template: 'external' };

          const [newVariant] = await db
            .insert(variants)
            .values({
              vertical_id: verticalId,
              slug,
              variant_type: 'external_url',
              external_url: externalUrl,
              config,
              traffic_weight: 50,
              version: 1,
            })
            .returning();

          await db.insert(variant_versions).values({
            variant_id: newVariant.id,
            version: 1,
            config,
            changed_by: 'agent',
            change_description: hypothesis,
          });

          await rebalanceWeights(verticalId);

          const [changeRecord] = await db
            .insert(agent_changes)
            .values({
              project_id: vertical.project_id,
              variant_id: newVariant.id,
              hypothesis,
              description: `Added external URL variant "${slug}" — ${label} (${externalUrl})`,
              change_type: 'copy',
              diff_summary: JSON.stringify({ action: 'create_external_variant', external_url: externalUrl, label }),
              previous_variant_version: 0,
              verdict: 'pending',
              min_sample_size: 500,
              samples_collected: 0,
            })
            .returning();

          return JSON.stringify({
            variant_id: newVariant.id,
            variant_type: 'external_url',
            slug,
            version: 1,
            vertical_name: vertical.name,
            vertical_slug: vertical.slug,
            external_url: externalUrl,
            label,
            change_id: changeRecord.id,
            status: 'active',
            message: `External URL variant "${slug}" created, tracking ${externalUrl}. Traffic weights rebalanced.`,
          });
        }

        // ---- Template variant ----
        const config = input.config as Record<string, unknown>;
        if (!config || !config.headline || !config.subheadline || !config.cta_primary || !config.template || !config.meta_title) {
          return JSON.stringify({
            error: 'Config must include: headline, subheadline, body_copy, cta_primary ({text, action}), template, meta_title, meta_description',
          });
        }

        const [newVariant] = await db
          .insert(variants)
          .values({
            vertical_id: verticalId,
            slug,
            variant_type: 'template',
            config,
            traffic_weight: 50,
            version: 1,
          })
          .returning();

        await db.insert(variant_versions).values({
          variant_id: newVariant.id,
          version: 1,
          config,
          changed_by: 'agent',
          change_description: hypothesis,
        });

        await rebalanceWeights(verticalId);

        const [changeRecord] = await db
          .insert(agent_changes)
          .values({
            project_id: vertical.project_id,
            variant_id: newVariant.id,
            hypothesis,
            description: `Created new variant "${slug}" — ${expectedImpact}`,
            change_type: 'copy',
            diff_summary: JSON.stringify({ action: 'create_variant', config }),
            previous_variant_version: 0,
            verdict: 'pending',
            min_sample_size: 500,
            samples_collected: 0,
          })
          .returning();

        const liveUrl = `/lp/${vertical.slug}/${slug}`;

        return JSON.stringify({
          variant_id: newVariant.id,
          variant_type: 'template',
          slug,
          version: 1,
          vertical_name: vertical.name,
          vertical_slug: vertical.slug,
          live_url: liveUrl,
          change_id: changeRecord.id,
          headline: config.headline,
          config,
          status: 'active',
          message: `Variant "${slug}" created and live at ${liveUrl}. Traffic weights rebalanced.`,
        });
      }

      case 'calculate_required_sample': {
        const controlVisitors = input.current_visitors_control as number;
        const controlConversions = input.current_conversions_control as number;
        const variantVisitors = input.current_visitors_variant as number;
        const variantConversions = input.current_conversions_variant as number;
        const mde = (input.minimum_detectable_effect as number) ?? 0.05;

        const significance = calculateSignificance(
          controlVisitors,
          controlConversions,
          variantVisitors,
          variantConversions
        );

        const controlRate = controlVisitors > 0 ? controlConversions / controlVisitors : 0;
        const minSample = calculateMinSampleSize(Math.max(controlRate, 0.01), mde);

        const controlPct = minSample > 0
          ? Math.min(100, Math.round((controlVisitors / minSample) * 100))
          : 100;
        const variantPct = minSample > 0
          ? Math.min(100, Math.round((variantVisitors / minSample) * 100))
          : 100;

        return JSON.stringify({
          significance,
          required_sample_per_variant: minSample,
          control: {
            visitors: controlVisitors,
            conversions: controlConversions,
            convRate: controlRate,
            pct_of_required: controlPct,
            still_needed: Math.max(0, minSample - controlVisitors),
          },
          variant: {
            visitors: variantVisitors,
            conversions: variantConversions,
            convRate: variantVisitors > 0 ? variantConversions / variantVisitors : 0,
            pct_of_required: variantPct,
            still_needed: Math.max(0, minSample - variantVisitors),
          },
          minimum_detectable_effect: mde,
        });
      }

      case 'get_ad_spend_overview': {
        const projectId = input.project_id as string;
        const days = (input.date_range_days as number) ?? 30;

        const since = new Date();
        since.setDate(since.getDate() - days);

        const rows = await db
          .select({
            platform: ad_spend_records.platform,
            vertical_id: ad_spend_records.vertical_id,
            spend: ad_spend_records.spend,
            platform_conversions: ad_spend_records.platform_conversions,
          })
          .from(ad_spend_records)
          .where(
            and(
              eq(ad_spend_records.project_id, projectId),
              gte(ad_spend_records.date, since)
            )
          );

        const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
        const totalConversions = rows.reduce(
          (s, r) => s + (r.platform_conversions ?? 0),
          0
        );
        const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : null;

        // Spend by platform
        const byPlatform: Record<string, number> = {};
        for (const r of rows) {
          byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + (r.spend ?? 0);
        }
        const topPlatform =
          Object.entries(byPlatform).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        // Spend by vertical
        const byVertical: Record<string, number> = {};
        for (const r of rows) {
          const key = r.vertical_id ?? 'unattributed';
          byVertical[key] = (byVertical[key] ?? 0) + (r.spend ?? 0);
        }

        return JSON.stringify({
          project_id: projectId,
          date_range_days: days,
          total_spend: totalSpend,
          total_conversions: totalConversions,
          avg_cpa: avgCpa,
          top_platform: topPlatform,
          spend_by_platform: byPlatform,
          spend_by_vertical: byVertical,
          record_count: rows.length,
        });
      }

      case 'get_campaign_performance': {
        const projectId = input.project_id as string;
        const platform = input.platform as string | undefined;

        const conditions = platform
          ? and(
              eq(ad_spend_records.project_id, projectId),
              eq(ad_spend_records.platform, platform)
            )
          : eq(ad_spend_records.project_id, projectId);

        const rows = await db
          .select({
            campaign_id: ad_spend_records.campaign_id,
            campaign_name: ad_spend_records.campaign_name,
            platform: ad_spend_records.platform,
            totalSpend: sql<number>`sum(${ad_spend_records.spend})`.as('total_spend'),
            totalImpressions: sql<number>`sum(${ad_spend_records.impressions})`.as('total_impressions'),
            totalClicks: sql<number>`sum(${ad_spend_records.clicks})`.as('total_clicks'),
            totalConversions: sql<number>`sum(${ad_spend_records.platform_conversions})`.as('total_conversions'),
          })
          .from(ad_spend_records)
          .where(conditions)
          .groupBy(
            ad_spend_records.campaign_id,
            ad_spend_records.campaign_name,
            ad_spend_records.platform
          )
          .orderBy(desc(sql`total_spend`))
          .limit(20);

        const campaigns = rows.map((r) => ({
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name,
          platform: r.platform,
          spend: Number(r.totalSpend ?? 0),
          impressions: Number(r.totalImpressions ?? 0),
          clicks: Number(r.totalClicks ?? 0),
          conversions: Number(r.totalConversions ?? 0),
          cpa:
            Number(r.totalConversions ?? 0) > 0
              ? Number(r.totalSpend ?? 0) / Number(r.totalConversions ?? 0)
              : null,
        }));

        return JSON.stringify({ campaigns, count: campaigns.length, platform: platform ?? 'all' });
      }

      case 'get_budget_recommendations': {
        const projectId = input.project_id as string;

        const rows = await db
          .select({
            campaign_id: ad_spend_records.campaign_id,
            campaign_name: ad_spend_records.campaign_name,
            platform: ad_spend_records.platform,
            totalSpend: sql<number>`sum(${ad_spend_records.spend})`.as('total_spend'),
            totalConversions: sql<number>`sum(${ad_spend_records.platform_conversions})`.as('total_conversions'),
          })
          .from(ad_spend_records)
          .where(eq(ad_spend_records.project_id, projectId))
          .groupBy(
            ad_spend_records.campaign_id,
            ad_spend_records.campaign_name,
            ad_spend_records.platform
          )
          .orderBy(desc(sql`total_spend`));

        const withCpa = rows
          .filter((r) => Number(r.totalConversions ?? 0) > 0)
          .map((r) => ({
            campaign_id: r.campaign_id,
            campaign_name: r.campaign_name,
            platform: r.platform,
            spend: Number(r.totalSpend ?? 0),
            conversions: Number(r.totalConversions ?? 0),
            cpa: Number(r.totalSpend ?? 0) / Number(r.totalConversions ?? 0),
          }));

        if (withCpa.length === 0) {
          return JSON.stringify({
            recommendations: [],
            message: 'No conversion data available yet. Recommendations will appear once campaigns have tracked conversions.',
          });
        }

        const avgCpa = withCpa.reduce((s, c) => s + c.cpa, 0) / withCpa.length;

        const recommendations = withCpa.map((c) => {
          let action: 'increase' | 'decrease' | 'maintain';
          let reason: string;
          if (c.cpa < avgCpa * 0.5) {
            action = 'increase';
            reason = `CPA $${c.cpa.toFixed(2)} is ${((1 - c.cpa / avgCpa) * 100).toFixed(0)}% below average ($${avgCpa.toFixed(2)}). Strong performer — consider scaling budget.`;
          } else if (c.cpa > avgCpa * 2) {
            action = 'decrease';
            reason = `CPA $${c.cpa.toFixed(2)} is ${((c.cpa / avgCpa - 1) * 100).toFixed(0)}% above average ($${avgCpa.toFixed(2)}). Underperformer — consider reducing budget.`;
          } else {
            action = 'maintain';
            reason = `CPA $${c.cpa.toFixed(2)} is within normal range of average ($${avgCpa.toFixed(2)}).`;
          }
          return { ...c, action, reason };
        });

        recommendations.sort((a, b) => {
          const order = { increase: 0, decrease: 1, maintain: 2 };
          return order[a.action] - order[b.action];
        });

        return JSON.stringify({
          average_cpa: avgCpa,
          recommendations,
          total_campaigns_analyzed: withCpa.length,
        });
      }

      // -----------------------------------------------------------------------
      // GitHub tools
      // -----------------------------------------------------------------------

      case 'fork_page': {
        const repoKey = input.repo as string;
        let sourcePath = input.source_path as string | undefined;
        const verticalId = input.vertical_id as string;

        // If source_path not provided, look up the vertical's source_file
        if (!sourcePath) {
          const [vert] = await db.select().from(verticals).where(eq(verticals.id, verticalId)).limit(1);
          if (vert?.source_file) {
            sourcePath = vert.source_file;
          } else {
            return JSON.stringify({ error: 'source_path is required (or set source_file on the vertical)' });
          }
        }

        try {
          const result = await forkPage({
            repoKey: repoKey as 'greenhouse' | 'popcorn',
            sourcePath,
            newRoute: input.new_route as string,
            textReplacements: (input.text_replacements as Array<{ find: string; replace: string }>) ?? [],
            verticalId,
            hypothesis: input.hypothesis as string,
            description: input.description as string,
            changedBy: 'agent',
          });
          return JSON.stringify(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      }

      case 'read_file': {
        const repoKey = input.repo as string;
        const filePath = input.path as string;

        if (!isRepoKey(repoKey)) {
          return JSON.stringify({ error: 'repo must be "greenhouse" or "popcorn"' });
        }

        const perm = validateFileAccess(repoKey, filePath, 'read');
        if (!perm.allowed) {
          return JSON.stringify({ error: perm.reason });
        }

        const repoFull = resolveRepo(repoKey);
        const file = await getFileContent(repoFull, filePath);

        return JSON.stringify({
          repo: repoKey,
          path: file.path,
          content: file.content,
          sha: file.sha,
        });
      }

      case 'list_repo_files': {
        const repoKey = input.repo as string;
        const dirPath = input.path as string;

        if (!isRepoKey(repoKey)) {
          return JSON.stringify({ error: 'repo must be "greenhouse" or "popcorn"' });
        }

        const repoFull = resolveRepo(repoKey);
        const files = await listRepoContents(repoFull, dirPath);

        return JSON.stringify({
          repo: repoKey,
          path: dirPath,
          files: files.map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size })),
          count: files.length,
        });
      }

      case 'propose_code_change': {
        const repoKey = input.repo as string;
        const filePath = input.file_path as string;
        const newContent = input.new_content as string;
        const isNewFile = (input.is_new_file as boolean) ?? false;
        const hypothesis = input.hypothesis as string;
        const description = input.description as string;
        const expectedImpact = input.expected_impact as string;
        const changeType = input.change_type as string;
        const variantId = input.variant_id as string | undefined;

        if (!isRepoKey(repoKey)) {
          return JSON.stringify({ error: 'repo must be "greenhouse" or "popcorn"' });
        }

        // Permission check
        const perm = validateFileAccess(repoKey, filePath, 'write');
        if (!perm.allowed) {
          return JSON.stringify({ error: `Permission denied: ${perm.reason}` });
        }

        const repoFull = resolveRepo(repoKey);

        // Get current file content + SHA (needed to update existing files)
        let currentFile: { content: string; sha: string } | null = null;
        if (!isNewFile) {
          try {
            currentFile = await getFileContent(repoFull, filePath);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: `Could not read current file: ${msg}` });
          }
        }

        // Resolve variant for DB record
        let resolvedVariantId = variantId;
        let projectId: string | undefined;

        if (resolvedVariantId) {
          const [variant] = await db.select().from(variants).where(eq(variants.id, resolvedVariantId)).limit(1);
          if (variant) {
            const [vert] = await db.select().from(verticals).where(eq(verticals.id, variant.vertical_id)).limit(1);
            projectId = vert?.project_id;
          }
        }

        // Fallback: use first project
        if (!projectId) {
          const [firstProject] = await db.select({ id: projects.id }).from(projects).limit(1);
          projectId = firstProject?.id;
        }
        if (!projectId) {
          return JSON.stringify({ error: 'No project found to associate this change with' });
        }

        // Fallback variant: first variant of first project
        if (!resolvedVariantId) {
          const [firstVariant] = await db.select({ id: variants.id }).from(variants).limit(1);
          if (firstVariant) resolvedVariantId = firstVariant.id;
        }
        if (!resolvedVariantId) {
          return JSON.stringify({ error: 'No variant found to associate this change with' });
        }

        const [currentVariant] = await db.select().from(variants).where(eq(variants.id, resolvedVariantId)).limit(1);
        const currentVersion = currentVariant?.version ?? 1;

        // Create agent_change record first (to get the ID for PR body)
        const [insertedChange] = await db
          .insert(agent_changes)
          .values({
            project_id: projectId,
            variant_id: resolvedVariantId,
            hypothesis,
            description,
            change_type: changeType,
            change_source: 'code',
            file_path: filePath,
            github_repo: repoKey,
            diff_summary: JSON.stringify({ file_path: filePath, expected_impact: expectedImpact }),
            previous_variant_version: currentVersion,
            verdict: 'proposed',
            min_sample_size: 500,
            samples_collected: 0,
          })
          .returning();

        const changeId = insertedChange.id;

        // Create branch
        const branchName = buildBranchName(changeType, hypothesis.slice(0, 60));
        try {
          await createBranch(repoFull, branchName);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Clean up the change record
          await db.delete(agent_changes).where(eq(agent_changes.id, changeId));
          return JSON.stringify({ error: `Failed to create branch: ${msg}` });
        }

        // Commit the file (create or update)
        const commitMessage = `[Greenhouse Agent] ${description.slice(0, 72)}`;
        try {
          if (isNewFile) {
            await createFile(repoFull, filePath, newContent, commitMessage, branchName);
          } else {
            await updateFile(repoFull, filePath, newContent, commitMessage, branchName, currentFile!.sha);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db.delete(agent_changes).where(eq(agent_changes.id, changeId));
          return JSON.stringify({ error: `Failed to commit file: ${msg}` });
        }

        // Create PR
        const prTitle = `[Greenhouse] ${hypothesis.slice(0, 70)}`;
        const prBody = buildPRBody({
          hypothesis,
          description,
          expectedImpact,
          changeType,
          filePath,
          changeId,
        });

        let prResult: { number: number; url: string };
        try {
          prResult = await createPullRequest(repoFull, branchName, 'main', prTitle, prBody);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db.delete(agent_changes).where(eq(agent_changes.id, changeId));
          return JSON.stringify({ error: `Failed to create PR: ${msg}` });
        }

        // Update agent_change with PR info
        await db
          .update(agent_changes)
          .set({
            pr_url: prResult.url,
            pr_number: prResult.number,
            branch_name: branchName,
          })
          .where(eq(agent_changes.id, changeId));

        // Infer the deployed route from the file path (e.g. src/app/credits-v2/page.tsx → /credits-v2)
        let deployedRoute: string | null = null;
        const appRouteMatch = filePath.match(/src\/app\/(.+?)\/page\.(tsx?|jsx?)$/);
        if (appRouteMatch) {
          deployedRoute = '/' + appRouteMatch[1];
        }

        // If this is a new file creating a new route, auto-create an external URL variant
        // pointing to where it will be deployed, so it's tracked in Greenhouse
        let linkedVariantId: string | null = null;
        if (isNewFile && deployedRoute && resolvedVariantId) {
          try {
            // Get the domain from env or default
            const domain = process.env.NEXT_PUBLIC_POPCORN_URL ?? process.env.VERCEL_URL ?? '';
            const deployedUrl = domain ? `${domain}${deployedRoute}` : deployedRoute;

            const [linkedVariant] = await db
              .insert(variants)
              .values({
                vertical_id: currentVariant?.vertical_id ?? (await db.select().from(variants).where(eq(variants.id, resolvedVariantId)).limit(1))[0]?.vertical_id,
                slug: `variant-${Date.now().toString(36)}`,
                variant_type: 'external_url',
                external_url: deployedUrl,
                config: {
                  label: `${hypothesis.slice(0, 50)} (PR #${prResult.number})`,
                  external_url: deployedUrl,
                  template: 'external',
                },
                traffic_weight: 0, // starts at 0 until merged
                version: 1,
                status: 'paused', // paused until PR is merged
              })
              .returning();

            if (linkedVariant) {
              linkedVariantId = linkedVariant.id;
              await db.insert(variant_versions).values({
                variant_id: linkedVariant.id,
                version: 1,
                config: linkedVariant.config as Record<string, unknown>,
                changed_by: 'agent',
                change_description: `Auto-created from PR #${prResult.number}`,
              });
            }
          } catch {
            // Non-critical — skip if variant creation fails
          }
        }

        return JSON.stringify({
          change_id: changeId,
          pr_number: prResult.number,
          pr_url: prResult.url,
          branch: branchName,
          repo: repoKey,
          file_path: filePath,
          is_new_file: isNewFile,
          deployed_route: deployedRoute,
          linked_variant_id: linkedVariantId,
          hypothesis,
          status: 'proposed',
          message: `PR #${prResult.number} created.${deployedRoute ? ` New route: ${deployedRoute}.` : ''} Awaiting human review and merge at: ${prResult.url}`,
        });
      }

      case 'get_pr_status': {
        const changeId = input.change_id as string;

        const [change] = await db
          .select()
          .from(agent_changes)
          .where(eq(agent_changes.id, changeId))
          .limit(1);

        if (!change) {
          return JSON.stringify({ error: 'Change not found' });
        }

        if (!change.pr_number || !change.github_repo) {
          return JSON.stringify({
            change_id: changeId,
            has_pr: false,
            verdict: change.verdict,
            message: 'This change has no associated PR (it is a config-level change)',
          });
        }

        const repoKey = change.github_repo as 'greenhouse' | 'popcorn';
        const repoFull = resolveRepo(repoKey);
        const prStatus = await getPullRequestStatus(repoFull, change.pr_number);

        return JSON.stringify({
          change_id: changeId,
          has_pr: true,
          pr_number: change.pr_number,
          pr_url: change.pr_url,
          pr_state: prStatus.state,
          pr_merged: prStatus.merged,
          pr_merged_at: prStatus.mergedAt,
          pr_closed_at: prStatus.closedAt,
          verdict: change.verdict,
          hypothesis: change.hypothesis,
        });
      }

      case 'generate_wireframe': {
        const title = input.title as string;
        const sections = input.sections as Array<{ type: string; content: string }>;
        const sourcePath = input.source_path as string;
        const variantLabel = input.variant_label as string | undefined;

        const ascii = sections.map((s) => s.content).join('\n\n');

        return JSON.stringify({
          type: 'wireframe',
          title,
          ascii,
          source_path: sourcePath,
          variant_label: variantLabel ?? null,
          section_count: sections.length,
          message: 'Wireframe preview generated.',
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}
