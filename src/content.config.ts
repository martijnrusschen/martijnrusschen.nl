import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Posts and pages, migrated from WordPress (October 2026). Drafts stay in the
// repo with `draft: true`: visible in `npm run dev`, never in a build.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    description: z.string().optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    lang: z.enum(['en', 'nl']).default('en'),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(9),
  }),
});

export const collections = { blog, pages };
