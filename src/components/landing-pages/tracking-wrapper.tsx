'use client';

import { useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { init, track, setUserProperties, setUserPropertiesOnce } from '@/lib/amplitude/client';
import { detectTrafficSource, parseUTMParams } from '@/lib/traffic/source-detection';
import type { RoutingMethod } from '@/lib/traffic/ad-routing';
import {
  LP_PAGE_VIEWED,
  LP_CTA_CLICKED,
  type LPPageViewedProperties,
  type LPCTAClickedProperties,
} from '@/lib/amplitude/events';

interface TrackingContext {
  trackCTAClick: (
    ctaType: 'primary' | 'secondary',
    ctaText: string,
    ctaPosition: 'hero' | 'mid_page' | 'footer' | 'sticky'
  ) => void;
}

const TrackingCtx = createContext<TrackingContext>({
  trackCTAClick: () => {},
});

export function useTracking() {
  return useContext(TrackingCtx);
}

interface TrackingWrapperProps {
  projectId: string;
  verticalId: string;
  variantId: string;
  variantVersion: number;
  routingMethod: RoutingMethod;
  children: React.ReactNode;
}

function detectDeviceType(width: number): 'mobile' | 'tablet' | 'desktop' {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function getBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  return 'Other';
}

function getOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  return 'Other';
}

export function TrackingWrapper({
  projectId,
  verticalId,
  variantId,
  variantVersion,
  routingMethod,
  children,
}: TrackingWrapperProps) {
  const pageViewFiredRef = useRef(false);
  const pageLoadTimeRef = useRef<number>(Date.now());
  const maxScrollDepthRef = useRef<number>(0);

  // Track scroll depth
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const depth = Math.round((scrollTop / docHeight) * 100);
        if (depth > maxScrollDepthRef.current) {
          maxScrollDepthRef.current = depth;
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fire page view on mount
  useEffect(() => {
    if (pageViewFiredRef.current) return;
    pageViewFiredRef.current = true;

    init();

    const searchParams = new URLSearchParams(window.location.search);
    const referrer = document.referrer;
    const trafficSource = detectTrafficSource(searchParams, referrer);
    const utmParams = parseUTMParams(searchParams);
    const viewport = window.innerWidth;
    const screen = window.screen.width;
    const deviceType = detectDeviceType(viewport);

    // First-touch user properties (set once)
    setUserPropertiesOnce({
      first_traffic_source: trafficSource,
      first_utm_source: utmParams.utm_source,
      first_utm_medium: utmParams.utm_medium,
      first_utm_campaign: utmParams.utm_campaign,
      first_utm_content: utmParams.utm_content,
      first_vertical_id: verticalId,
      first_variant_id: variantId,
      first_landing_page_version: variantVersion,
      first_project_id: projectId,
    });

    // Last-touch user properties (always update)
    setUserProperties({
      last_traffic_source: trafficSource,
      last_utm_source: utmParams.utm_source,
      last_utm_medium: utmParams.utm_medium,
      last_utm_campaign: utmParams.utm_campaign,
      last_vertical_id: verticalId,
      last_variant_id: variantId,
    });

    // Set routing method as a user property for segmentation
    setUserPropertiesOnce({ first_routing_method: routingMethod });
    setUserProperties({ last_routing_method: routingMethod });

    const eventProps: LPPageViewedProperties = {
      project_id: projectId,
      vertical_id: verticalId,
      variant_id: variantId,
      variant_version: variantVersion,
      traffic_source: trafficSource,
      routing_method: routingMethod,
      ...utmParams,
      device_type: deviceType,
      screen_width: screen,
      viewport_width: viewport,
      browser: getBrowser(),
      os: getOS(),
      referrer_url: referrer,
    };

    track(LP_PAGE_VIEWED, eventProps as unknown as Record<string, unknown>);
  }, [projectId, verticalId, variantId, variantVersion, routingMethod]);

  const trackCTAClick = useCallback(
    (
      ctaType: 'primary' | 'secondary',
      ctaText: string,
      ctaPosition: 'hero' | 'mid_page' | 'footer' | 'sticky'
    ) => {
      const timeOnPage = Math.round((Date.now() - pageLoadTimeRef.current) / 1000);
      const eventProps: LPCTAClickedProperties = {
        project_id: projectId,
        vertical_id: verticalId,
        variant_id: variantId,
        variant_version: variantVersion,
        cta_type: ctaType,
        cta_text: ctaText,
        cta_position: ctaPosition,
        time_on_page_seconds: timeOnPage,
        scroll_depth_percent: maxScrollDepthRef.current,
      };
      track(LP_CTA_CLICKED, eventProps as unknown as Record<string, unknown>);
    },
    [projectId, verticalId, variantId, variantVersion]
  );

  return (
    <TrackingCtx.Provider value={{ trackCTAClick }}>
      {children}
    </TrackingCtx.Provider>
  );
}
