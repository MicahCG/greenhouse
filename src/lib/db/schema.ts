import { pgTable, uuid, text, real, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  funnel_focus: text('funnel_focus').notNull(), // acquisition | activation | monetization | retention | referral
  status: text('status').notNull().default('active'), // active | paused | completed
  significance_threshold: real('significance_threshold').notNull().default(0.95),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

export const verticals = pgTable('verticals', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'), // active | paused | archived
  traffic_split_strategy: text('traffic_split_strategy').notNull().default('equal'), // equal | weighted | champion_challenger
  created_at: timestamp('created_at').defaultNow(),
});

export const variants = pgTable('variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  vertical_id: uuid('vertical_id').notNull().references(() => verticals.id),
  slug: text('slug').notNull(),
  version: integer('version').notNull().default(1),
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
  change_type: text('change_type').notNull(), // copy | layout | style | cta | image | template
  diff_summary: text('diff_summary'),
  commit_sha: text('commit_sha'),
  previous_variant_version: integer('previous_variant_version').notNull(),
  verdict: text('verdict').notNull().default('pending'), // pending | need_more_data | win | loss | neutral
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

export const ad_spend_records = pgTable('ad_spend_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_id: uuid('project_id').notNull().references(() => projects.id),
  vertical_id: uuid('vertical_id').references(() => verticals.id),
  variant_id: uuid('variant_id').references(() => variants.id),
  platform: text('platform').notNull(), // meta | google | tiktok | twitter
  campaign_id: text('campaign_id'),
  campaign_name: text('campaign_name'),
  spend: real('spend').notNull().default(0),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  date: timestamp('date').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});
