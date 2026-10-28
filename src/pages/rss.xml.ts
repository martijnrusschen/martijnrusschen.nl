import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, site } from '../lib';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: site.name,
    description: site.tagline,
    site: context.site ?? site.url,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.description,
      link: `/${p.id}/`,
    })),
  });
}
