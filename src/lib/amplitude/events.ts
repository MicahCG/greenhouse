import type { TrafficSource } from '@/lib/traffic/source-detection';
import type { RoutingMethod } from '@/lib/traffic/ad-routing';

export const LP_PAGE_VIEWED = 'lp_page_viewed';
export const LP_CTA_CLICKED = 'lp_cta_clicked';
export const REGISTRATION_STARTED = 'registration_started';
export const REGISTRATION_COMPLETED = 'registration_completed';

export interface LPPageViewedProperties {
  project_id: string;
  vertical_id: string;
  variant_id: string;
  variant_version: number;
  traffic_source: TrafficSource;
  routing_method: RoutingMethod;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  device_type: 'mobile' | 'tablet' | 'desktop';
  screen_width: number;
  viewport_width: number;
  browser: string;
  os: string;
  referrer_url: string;
}

export interface LPCTAClickedProperties {
  project_id: string;
  vertical_id: string;
  variant_id: string;
  variant_version: number;
  cta_type: 'primary' | 'secondary';
  cta_text: string;
  cta_position: 'hero' | 'mid_page' | 'footer' | 'sticky';
  time_on_page_seconds: number;
  scroll_depth_percent: number;
}

export interface RegistrationStartedProperties {
  project_id: string;
  vertical_id: string;
  variant_id: string;
  source_page: 'landing_page' | 'homepage' | 'other';
}

export interface RegistrationCompletedProperties {
  project_id: string;
  vertical_id: string;
  variant_id: string;
  registration_method: 'email' | 'google' | 'apple';
  time_to_register_seconds: number;
}
