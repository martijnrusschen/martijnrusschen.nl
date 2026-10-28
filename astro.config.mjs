// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static site on Cloudflare (Workers Static Assets, see wrangler.toml). URLs
// keep the WordPress shape (/slug/, /category/x/, /tag/x/) so old links work.
export default defineConfig({
  site: 'https://martijnrusschen.nl',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
