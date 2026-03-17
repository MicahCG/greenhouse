import { pgTable, uuid, text, real, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  funnel_focus: text('funnel_focus').notNull(), // acquisition | activation | monetization | retention | referral
  status: text('status').notNull().default('active'), // active | paused | completed | archived
  significance_threshold: real('significance_threshold').notNull().default(0.95),
  description: text('description'),
  tracked_events: jsonb('tracked_events').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

export const verticals = pgTable('verticals', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  source_url: text('source_url'),   // live page URL, e.g. "https://www.popcorn.co/credits"
  source_file: text('source_file'), // GitHub file path, e.g. "app/(sidebar)/credits/page.tsx"
  status: text('status').notNull().default('active'), // active | paused | archived
  traffic_split_strategy: text('traffic_split_strategy').notNull().default('equal'), // equal | weighted | champion_challenger
  created_at: timestamp('created_at').defaultNow(),
});

export const variants = pgTable('variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  vertical_id: uuid('vertical_id').notNull().references(() => verticals.id),
  slug: text('slug').notNull(),
  version: integer('version').notNull().default(1),
  variant_type: text('variant_type').notNull().default('template'), // 'template' | 'external_url'
  external_url: text('external_url'), // target page URL for external_url variants
  status: text('status').notNull().default('active'), // active | paused | winner | killed
  config: jsonb('config').notNull(),
  traffic_weight: integer('traffic_weight').notNull().default(50),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  vertical_slug_idx: uniqueIndex('variants_vertical_slug_idx').on(table.vertical_id, table.slug),
}));

export const agent_changes = pgTable('agent_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  variant_id: uuid('variant_id').notNull().references(() => variants.id),
  hypothesis: text('hypothesis').notNull(),
  description: text('description').notNull(),
  change_type: text('change_type').notNull(), // copy | layout | style | cta | image | template | code
  change_source: text('change_source').notNull().default('config'), // config | code
  diff_summary: text('diff_summary'),
  commit_sha: text('commit_sha'),
  // GitHub PR fields (populated when change_source = 'code')
  pr_url: text('pr_url'),
  pr_number: integer('pr_number'),
  github_repo: text('github_repo'), // 'greenhouse' | 'popcorn'
  branch_name: text('branch_name'),
  file_path: text('file_path'),
  preview_url: text('preview_url'), // Vercel deploy preview URL (populated after deploy)
  previous_variant_version: integer('previous_variant_version').notNull(),
  verdict: text('verdict').notNull().default('pending'), // pending | need_more_data | win | loss | neutral | proposed | rejected
  confidence_level: real('confidence_level'),
  min_sample_size: integer('min_sample_size').notNull().default(500),
  samples_collected: integer('samples_collected').notNull().default(0),
  implemented_at: timestamp('implemented_at').notNull().defaultNow(),
  evaluated_at: timestamp('evaluated_at'),
});

export const metric_snapshots = pgTable('metric_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_change_id: uuid('agent_change_id').notNull().references(() => agent_changes.id),
  snapshot_type: text('snapshot_type').notNull(), // baseline | current | rolling_average
  visitors: integer('visitors').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
  conversion_rate: real('conversion_rate').notNull().default(0),
  bounce_rate: real('bounce_rate'),
  avg_time_on_page: real('avg_time_on_page'),
  cta_click_rate: real('cta_click_rate'),
  window_days: integer('window_days').notNull(),
  captured_at: timestamp('captured_at').notNull().defaultNow(),
});

export const ad_creatives = pgTable('ad_creatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  platform: text('platform').notNull(), // meta | google | linkedin
  format: text('format').notNull(), // video | image | carousel | text | story | reel | responsive
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('active'), // active | paused | archived
  copy_headline: text('copy_headline'),
  copy_body: text('copy_body'),
  copy_cta: text('copy_cta'),
  media_url: text('media_url'),
  thumbnail_url: text('thumbnail_url'),
  platform_campaign_id: text('platform_campaign_id'),
  platform_ad_id: text('platform_ad_id'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

export const ad_assignments = pgTable('ad_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ad_creative_id: uuid('ad_creative_id').notNull().references(() => ad_creatives.id),
  vertical_id: uuid('vertical_id').notNull().references(() => verticals.id),
  variant_id: uuid('variant_id').references(() => variants.id), // null = all variants in the vertical
  status: text('status').notNull().default('active'), // active | paused | ended
  utm_content_tag: text('utm_content_tag').notNull(), // e.g. meta-video-v1-creators-variant-a
  daily_budget: real('daily_budget'),
  start_date: timestamp('start_date').notNull().defaultNow(),
  end_date: timestamp('end_date'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow(),
});

export const ad_spend_records = pgTable('ad_spend_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  vertical_id: uuid('vertical_id').references(() => verticals.id),
  variant_id: uuid('variant_id').references(() => variants.id),
  platform: text('platform').notNull(), // meta | google | linkedin
  campaign_id: text('campaign_id'),
  campaign_name: text('campaign_name'),
  spend: real('spend').notNull().default(0),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  cpc: real('cpc'),
  ctr: real('ctr'),
  platform_conversions: integer('platform_conversions').default(0),
  ad_creative_id: uuid('ad_creative_id').references(() => ad_creatives.id),
  date: timestamp('date').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

export const variant_versions = pgTable('variant_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  variant_id: uuid('variant_id').notNull().references(() => variants.id),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(),
  changed_by: text('changed_by').notNull().default('user'), // 'user' | 'agent'
  change_description: text('change_description'),
  agent_change_id: uuid('agent_change_id').references(() => agent_changes.id),
  created_at: timestamp('created_at').defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  type: text('type').notNull(), // 'change_verdict' | 'significance_reached' | 'underperformer' | 'need_more_data'
  title: text('title').notNull(),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'), // 'info' | 'warning' | 'success' | 'error'
  data: jsonb('data'),
  read_at: timestamp('read_at'),
  created_at: timestamp('created_at').defaultNow(),
});
