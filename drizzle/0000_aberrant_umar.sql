CREATE TABLE "ad_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_creative_id" uuid NOT NULL,
	"vertical_id" uuid NOT NULL,
	"variant_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"utm_content_tag" text NOT NULL,
	"daily_budget" real,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"copy_headline" text,
	"copy_body" text,
	"copy_cta" text,
	"media_url" text,
	"thumbnail_url" text,
	"platform_campaign_id" text,
	"platform_ad_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ad_spend_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"vertical_id" uuid,
	"variant_id" uuid,
	"platform" text NOT NULL,
	"campaign_id" text,
	"campaign_name" text,
	"spend" real DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"cpc" real,
	"ctr" real,
	"platform_conversions" integer DEFAULT 0,
	"ad_creative_id" uuid,
	"date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"hypothesis" text NOT NULL,
	"description" text NOT NULL,
	"change_type" text NOT NULL,
	"change_source" text DEFAULT 'config' NOT NULL,
	"diff_summary" text,
	"commit_sha" text,
	"pr_url" text,
	"pr_number" integer,
	"github_repo" text,
	"branch_name" text,
	"file_path" text,
	"preview_url" text,
	"previous_variant_version" integer NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"confidence_level" real,
	"min_sample_size" integer DEFAULT 500 NOT NULL,
	"samples_collected" integer DEFAULT 0 NOT NULL,
	"implemented_at" timestamp DEFAULT now() NOT NULL,
	"evaluated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_change_id" uuid NOT NULL,
	"snapshot_type" text NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"conversion_rate" real DEFAULT 0 NOT NULL,
	"bounce_rate" real,
	"avg_time_on_page" real,
	"cta_click_rate" real,
	"window_days" integer NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"data" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"funnel_focus" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"significance_threshold" real DEFAULT 0.95 NOT NULL,
	"description" text,
	"tracked_events" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "variant_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"changed_by" text DEFAULT 'user' NOT NULL,
	"change_description" text,
	"agent_change_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vertical_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"variant_type" text DEFAULT 'template' NOT NULL,
	"external_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb NOT NULL,
	"traffic_weight" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "verticals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"traffic_split_strategy" text DEFAULT 'equal' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "verticals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ad_assignments" ADD CONSTRAINT "ad_assignments_ad_creative_id_ad_creatives_id_fk" FOREIGN KEY ("ad_creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_assignments" ADD CONSTRAINT "ad_assignments_vertical_id_verticals_id_fk" FOREIGN KEY ("vertical_id") REFERENCES "public"."verticals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_assignments" ADD CONSTRAINT "ad_assignments_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_records" ADD CONSTRAINT "ad_spend_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_records" ADD CONSTRAINT "ad_spend_records_vertical_id_verticals_id_fk" FOREIGN KEY ("vertical_id") REFERENCES "public"."verticals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_records" ADD CONSTRAINT "ad_spend_records_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_records" ADD CONSTRAINT "ad_spend_records_ad_creative_id_ad_creatives_id_fk" FOREIGN KEY ("ad_creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_changes" ADD CONSTRAINT "agent_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_changes" ADD CONSTRAINT "agent_changes_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_agent_change_id_agent_changes_id_fk" FOREIGN KEY ("agent_change_id") REFERENCES "public"."agent_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_versions" ADD CONSTRAINT "variant_versions_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_versions" ADD CONSTRAINT "variant_versions_agent_change_id_agent_changes_id_fk" FOREIGN KEY ("agent_change_id") REFERENCES "public"."agent_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_vertical_id_verticals_id_fk" FOREIGN KEY ("vertical_id") REFERENCES "public"."verticals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verticals" ADD CONSTRAINT "verticals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variants_vertical_slug_idx" ON "variants" USING btree ("vertical_id","slug");