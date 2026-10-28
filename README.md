# martijnrusschen.nl

Personal blog of Martijn Russchen. Built with [Astro](https://astro.build/) and
served as static assets on Cloudflare (Workers Static Assets, like
russchenmedia). Migrated from WordPress in October 2026.

## Local development

```bash
npm install
npm run dev      # http://localhost:4321, drafts included
npm run build    # production build into dist/, drafts excluded
npm run deploy   # build + wrangler deploy
```

Requires Node 22+ (see `.nvmrc`).

## Writing

Posts are Markdown files in `src/content/blog/`. The file name is the URL:
`my-post.md` is served at `/my-post/`. Frontmatter:

```yaml
---
title: "Post title"
date: "2026-10-28"
updated: "2026-10-30"      # optional
description: "One or two sentences for the overview, RSS and social cards."
categories: ["smarthome"]  # names in src/categories.json
tags: ["home assistant"]
lang: "nl"                 # optional, default en
draft: true                # optional: only visible in npm run dev
---
```

Images go in `public/`. The images from the WordPress era keep their old paths
under `public/wp-content/uploads/`, so old image links still work.

Pages (About, Publications, Contact) live in `src/content/pages/` and are
served at `/slug/` as well.

## Deployment

`wrangler.toml` serves `dist/` as static assets. Security headers are in
`public/_headers`, redirects for old WordPress URLs (feed, categories, tags)
in `public/_redirects`.

Connect the repo once in the Cloudflare dashboard (Workers & Pages → Create →
Import a repository, build command `npm run build`, deploy command
`npx wrangler deploy`), then add `martijnrusschen.nl` under Custom domains.
