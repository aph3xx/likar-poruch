import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://aph3xx.github.io',
  base: '/likar-poruch',
  trailingSlash: 'always',
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })]
});
