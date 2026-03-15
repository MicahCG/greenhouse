import { z } from 'zod';

export const VariantConfigSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  body_copy: z.string(),
  cta_primary: z.object({
    text: z.string(),
    action: z.string(),
  }),
  cta_secondary: z.object({
    text: z.string(),
    action: z.string(),
  }).optional(),
  hero_image: z.string().optional(),
  social_proof: z.array(z.string()).optional(),
  template: z.string(), // "hero-centered" | "hero-split" | "video-first"
  theme: z.record(z.string(), z.string()).optional(),
  meta_title: z.string(),
  meta_description: z.string(),
  og_image: z.string().optional(),
});

export type VariantConfig = z.infer<typeof VariantConfigSchema>;
