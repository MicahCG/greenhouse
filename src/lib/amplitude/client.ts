'use client';

import * as amplitude from '@amplitude/analytics-browser';

let initialized = false;

export function init() {
  if (initialized || typeof window === 'undefined') return;
  const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  if (!apiKey) {
    console.warn('[Amplitude] NEXT_PUBLIC_AMPLITUDE_API_KEY not set');
    return;
  }
  amplitude.init(apiKey, {
    defaultTracking: false,
    autocapture: false,
  });
  initialized = true;
}

export function track(eventName: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  init();
  amplitude.track(eventName, properties);
}

export function identify(userId: string) {
  if (typeof window === 'undefined') return;
  init();
  amplitude.setUserId(userId);
}

export function setUserProperties(properties: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  init();
  const identifyEvent = new amplitude.Identify();
  for (const [key, value] of Object.entries(properties)) {
    identifyEvent.set(key, value as amplitude.Types.ValidPropertyType);
  }
  amplitude.identify(identifyEvent);
}

export function setUserPropertiesOnce(properties: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  init();
  const identifyEvent = new amplitude.Identify();
  for (const [key, value] of Object.entries(properties)) {
    identifyEvent.setOnce(key, value as amplitude.Types.ValidPropertyType);
  }
  amplitude.identify(identifyEvent);
}
