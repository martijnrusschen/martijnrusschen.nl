import { getCollection, type CollectionEntry } from 'astro:content';
import categoryNames from './categories.json';

export type Post = CollectionEntry<'blog'>;

/** Published posts, newest first. Drafts only show up in the dev server. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');

export const categoryName = (slug: string) =>
  (categoryNames as Record<string, string>)[slug] ?? slug;

export function formatDate(d: Date, lang = 'en') {
  return d.toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function readingTime(body = '') {
  const words = body.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

export const site = {
  name: 'Martijn Russchen',
  tagline: 'Product, home automation and the occasional deep dive.',
  url: 'https://martijnrusschen.nl',
  social: {
    github: 'https://github.com/martijnrusschen',
    linkedin: 'https://www.linkedin.com/in/mrusschen/',
    x: 'https://x.com/mrusschen',
  },
};
