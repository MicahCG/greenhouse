# Greenhouse

## What This Is

Greenhouse is the internal growth experimentation platform for Popcorn (AI movie creation platform). It serves two purposes from one Next.js repo deployed on Vercel:

1. **Public landing pages** (`/lp/[vertical]/[variant]`) — A/B tested pages targeting different market verticals, rendered from config
2. **Internal dashboard** (`/dashboard/...`) — Analytics, experiment management, agent chat, and accountability tracking (auth-protected)

## Architecture Overview

- **Framework**: Next.js 14+ (App Router)
- **Deployment**: Vercel
- **Database**: Postgres via Neon, using Drizzle ORM
- **Analytics**: Amplitude (JS SDK for client tracking, HTTP API for querying)
- **AI Agent**: Anthropic API with tool use for the Growth Expert chat
- **Auth**: Clerk (dashboard routes only)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Git**: GitHub API (Octokit) for writing to external Popcorn repo

## Key Concepts

### Projects
Top-level organizational unit. Each project targets a funnel stage (acquisition, activation, monetization, retention, referral). All experiments, verticals, and variants roll up to a project.

### Verticals
A market segment (e.g., "Creators", "Educators", "Brands"). Each vertical has its own URL slug and can have multiple variants.

### Variants
A specific version of a landing page within a vertical. Defined by a config (headline, subheadline, body, CTAs, template, theme). The agent modifies variant configs to optimize performance.

### Agent Changes
Every modification the Growth Expert agent makes is logged with: hypothesis, description, baseline metrics, and post-change benchmarks. Changes are verdicted as win/loss/neutral/need-more-data based on statistical significance.

## Route Structure

```
/lp/[vertical]/[variant]          → Public landing page (SSR, fast)
/dashboard                         → Project overview
/dashboard/projects/[id]           → Experiment grid for a project
/dashboard/projects/[id]/verticals/[vid]/variants/[varid] → Variant detail
/dashboard/analytics               → Traffic & attribution
/dashboard/ad-spend                → Ad spend management
/dashboard/agent-log               → Agent change history & accountability
/dashboard/chat                    → Growth Expert chat interface
/api/...                           → API routes
```

## Landing Page System

Landing pages are **config-driven**. Variant configs define content (copy, CTAs, images). Template components define layout. The `TrackingWrapper` component auto-instruments all Amplitude events.

**Traffic splitting** happens in Vercel Edge Middleware. On requests to `/lp/[vertical]`, middleware assigns the user to a variant via weighted random selection (persisted in cookie `gh_variant_[vertical_slug]`) and rewrites the URL.

## Amplitude Event Taxonomy

### User Properties (persist across sessions)
- `first_traffic_source`, `first_utm_source`, `first_utm_medium`, `first_utm_campaign`, `first_utm_content`, `first_vertical_id`, `first_variant_id`, `first_project_id`
- `last_traffic_source`, `last_utm_source`, `last_utm_medium`, `last_vertical_id`, `last_variant_id`

### Core Events
- `lp_page_viewed` — landing page load (includes vertical, variant, version, traffic source, device info)
- `lp_cta_clicked` — CTA interaction (includes position, scroll depth, time on page)
- `registration_started` — user begins signup
- `registration_completed` — signup done (includes method, time to register)

### Traffic Source Detection
Priority: UTM params → ad platform click IDs (gclid, fbclid, ttclid) → referrer analysis → direct

## Database Schema

Tables: `projects`, `verticals`, `variants`, `agent_changes`, `metric_snapshots`, `ad_spend_records`

All timestamps use UTC. All IDs are UUIDs.

## Code Conventions

- TypeScript strict mode everywhere
- Server components by default, `"use client"` only when needed
- API routes return consistent `{ data, error }` shape
- Zod for all input validation
- All Amplitude events go through `lib/amplitude/events.ts` type definitions
- Variant configs validated against `VariantConfig` Zod schema before save
- Agent changes always require a hypothesis and baseline snapshot before implementation

## Important Constraints

- The agent can ONLY modify variant configs (copy, CTAs, images, theme). It cannot modify template components, tracking code, or infrastructure without human approval.
- Statistical significance threshold defaults to 95% but is configurable per project.
- Minimum sample size must be met before any change verdict is rendered.
- All UTMs follow the standard: `utm_source=platform`, `utm_medium=traffic_type`, `utm_campaign=campaign_name`, `utm_content=variant_identifier`, `utm_term=targeting_detail`.

## File Organization

- `src/app/lp/` — Landing page routes
- `src/app/dashboard/` — Dashboard routes
- `src/app/api/` — API routes
- `src/components/landing-pages/` — LP templates and sections
- `src/components/dashboard/` — Dashboard UI components
- `src/lib/amplitude/` — Tracking client + server query + event types
- `src/lib/agent/` — System prompt, tools, change tracker
- `src/lib/stats/` — Statistical significance utilities
- `src/lib/traffic/` — UTM parsing + source detection
- `src/lib/db/` — Drizzle schema + queries
- `middleware.ts` — A/B traffic splitting + auth check
