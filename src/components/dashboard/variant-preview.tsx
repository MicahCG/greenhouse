'use client';

import type { VariantConfig } from '@/lib/types/variant-config';
import { HeroCentered } from '@/components/landing-pages/templates/hero-centered';
import { HeroSplit } from '@/components/landing-pages/templates/hero-split';
import { TrackingWrapper } from '@/components/landing-pages/tracking-wrapper';

function buildSafeConfig(partial: Partial<VariantConfig>): VariantConfig {
  return {
    headline: partial.headline || 'Your Headline Here',
    subheadline: partial.subheadline || 'Your subheadline goes here',
    body_copy: partial.body_copy || 'Tell your story here.',
    cta_primary: partial.cta_primary || { text: 'Get Started', action: '#' },
    cta_secondary: partial.cta_secondary,
    hero_image: partial.hero_image,
    social_proof: partial.social_proof,
    template: partial.template || 'hero-centered',
    theme: partial.theme,
    meta_title: partial.meta_title || 'Page Title',
    meta_description: partial.meta_description || '',
    og_image: partial.og_image,
  };
}

interface VariantPreviewProps {
  config: Partial<VariantConfig>;
}

export function VariantPreview({ config }: VariantPreviewProps) {
  const safe = buildSafeConfig(config);
  const Template = safe.template === 'hero-split' ? HeroSplit : HeroCentered;

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-white/10 bg-black"
      style={{ height: 380 }}
    >
      <div
        style={{
          transform: 'scale(0.33)',
          transformOrigin: 'top left',
          width: '303%',
          height: '303%',
          pointerEvents: 'none',
        }}
      >
        <TrackingWrapper
          projectId="preview"
          verticalId="preview"
          variantId="preview"
          variantVersion={1}
          routingMethod="direct"
        >
          <Template config={safe} />
        </TrackingWrapper>
      </div>
    </div>
  );
}
