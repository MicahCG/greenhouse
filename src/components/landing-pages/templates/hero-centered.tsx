'use client';

import type { CSSProperties } from 'react';
import { useTracking } from '@/components/landing-pages/tracking-wrapper';
import type { VariantConfig } from '@/lib/types/variant-config';

interface HeroCenteredProps {
  config: VariantConfig;
}

export function HeroCentered({ config }: HeroCenteredProps) {
  const { trackCTAClick } = useTracking();
  const { theme } = config;

  const primaryColor = theme?.primary ?? '#F5A623';
  const bgColor = theme?.background ?? '#0A0A0A';
  const textColor = theme?.text ?? '#FFFFFF';

  const wrapStyle: CSSProperties = { backgroundColor: bgColor, color: textColor };
  const ctaStyle: CSSProperties = { backgroundColor: primaryColor };

  return (
    <div style={wrapStyle} className="min-h-screen font-sans">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-24 text-center max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-tight mb-6">
          {config.headline}
        </h1>
        <p className="text-xl md:text-2xl opacity-80 mb-10 max-w-2xl">
          {config.subheadline}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href={config.cta_primary.action}
            onClick={() => trackCTAClick('primary', config.cta_primary.text, 'hero')}
            style={ctaStyle}
            className="px-8 py-4 rounded-lg text-black font-bold text-lg hover:opacity-90 transition-opacity"
          >
            {config.cta_primary.text}
          </a>
          {config.cta_secondary && (
            <a
              href={config.cta_secondary.action}
              onClick={() => trackCTAClick('secondary', config.cta_secondary!.text, 'hero')}
              className="px-8 py-4 rounded-lg border border-white/30 font-semibold text-lg hover:border-white/60 transition-colors"
            >
              {config.cta_secondary.text}
            </a>
          )}
        </div>
      </section>

      {/* Body Copy */}
      <section className="px-6 py-16 max-w-3xl mx-auto text-center">
        <p className="text-lg opacity-70 leading-relaxed">{config.body_copy}</p>
      </section>

      {/* Social Proof */}
      {config.social_proof && config.social_proof.length > 0 && (
        <section className="px-6 py-16 border-t border-white/10">
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            {config.social_proof.map((proof, i) => (
              <blockquote key={i} className="text-sm opacity-60 italic text-center">
                {proof}
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {/* Footer CTA */}
      <section className="px-6 py-20 text-center">
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
