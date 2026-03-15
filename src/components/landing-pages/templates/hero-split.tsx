'use client';

import type { CSSProperties } from 'react';
import Image from 'next/image';
import { useTracking } from '@/components/landing-pages/tracking-wrapper';
import type { VariantConfig } from '@/lib/types/variant-config';

interface HeroSplitProps {
  config: VariantConfig;
}

export function HeroSplit({ config }: HeroSplitProps) {
  const { trackCTAClick } = useTracking();
  const { theme } = config;

  const primaryColor = theme?.primary ?? '#F5A623';
  const bgColor = theme?.background ?? '#0A0A0A';
  const textColor = theme?.text ?? '#FFFFFF';

  const wrapStyle: CSSProperties = { backgroundColor: bgColor, color: textColor };
  const ctaStyle: CSSProperties = { backgroundColor: primaryColor };
  const placeholderStyle: CSSProperties = { borderColor: primaryColor };

  return (
    <div style={wrapStyle} className="min-h-screen font-sans">
      {/* Hero — split layout */}
      <section className="flex flex-col md:flex-row items-center max-w-6xl mx-auto px-6 py-20 gap-12">
        {/* Left: text */}
        <div className="flex-1">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
            {config.headline}
          </h1>
          <p className="text-lg md:text-xl opacity-80 mb-8">
            {config.subheadline}
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href={config.cta_primary.action}
              onClick={() => trackCTAClick('primary', config.cta_primary.text, 'hero')}
              style={ctaStyle}
              className="px-8 py-4 rounded-lg text-black font-bold text-lg hover:opacity-90 transition-opacity inline-block text-center"
            >
              {config.cta_primary.text}
            </a>
            {config.cta_secondary && (
              <a
                href={config.cta_secondary.action}
                onClick={() => trackCTAClick('secondary', config.cta_secondary!.text, 'hero')}
                className="px-8 py-4 rounded-lg border border-white/30 font-semibold text-lg hover:border-white/60 transition-colors text-center"
              >
                {config.cta_secondary.text}
              </a>
            )}
          </div>
        </div>

        {/* Right: image */}
        <div className="flex-1 flex items-center justify-center">
          {config.hero_image ? (
            <Image
              src={config.hero_image}
              alt={config.headline}
              width={560}
              height={420}
              className="rounded-2xl object-cover w-full max-w-lg"
            />
          ) : (
            <div
              style={placeholderStyle}
              className="w-full max-w-lg aspect-video rounded-2xl border-2 border-dashed flex items-center justify-center opacity-20"
            >
              <span className="text-4xl">🎬</span>
            </div>
          )}
        </div>
      </section>

      {/* Body Copy */}
      <section className="px-6 py-16 max-w-3xl mx-auto">
        <p className="text-lg opacity-70 leading-relaxed">{config.body_copy}</p>
      </section>

      {/* Social Proof */}
      {config.social_proof && config.social_proof.length > 0 && (
        <section className="px-6 py-16 border-t border-white/10">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            {config.social_proof.map((proof, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/10 p-6 text-sm opacity-70"
              >
                {proof}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer CTA */}
      <section className="px-6 py-20 text-center">
        <p className="text-lg opacity-60 mb-6">Ready to get started?</p>
        <a
          href={config.cta_primary.action}
          onClick={() => trackCTAClick('primary', config.cta_primary.text, 'footer')}
          style={ctaStyle}
          className="px-10 py-5 rounded-lg text-black font-bold text-xl hover:opacity-90 transition-opacity inline-block"
        >
          {config.cta_primary.text}
        </a>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-white/10 text-center opacity-40 text-sm">
        © 2026 Popcorn. All rights reserved.
      </footer>
    </div>
  );
}
