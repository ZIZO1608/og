/* ==========================================================================
   ogsports1.com — assemble the web root
   --------------------------------------------------------------------------
   Run by site/Dockerfile's build stage, and runnable by hand:

       node site/build.mjs                       -> site/dist/
       SITE_URL=https://example.com node site/build.mjs

   THERE ARE EXACTLY TWO JOBS HERE, and both exist because the alternative is
   a fact kept in two places.

   1. THE DOMAIN. Every absolute link in the pages — the canonical, the three
      hreflang lines, the Open Graph url and image, both @id values in the
      structured data, both entries in the sitemap and the Sitemap: line in
      robots.txt — is written for https://ogsports1.com. That is a real
      address rather than a placeholder, so the committed files are valid on
      their own and can be opened, validated and pushed to Search Console as
      they stand. Building with SITE_URL set rewrites all of them at once.
      A canonical pointing at a domain that does not answer tells Google to
      index nothing, which is the one SEO mistake that costs everything.

   2. THE DATE. <lastmod> is stamped with the day the site is built. A date
      somebody has to remember to edit is a date that is wrong within a month,
      and a sitemap whose lastmod is not trusted is a sitemap that is ignored.

   An allow-list, not a copy-everything: a file appears on a public server
   because it is named here.
   ========================================================================== */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SITE_DIR, '..');

const OUT      = resolve(process.env.OUT_DIR || join(SITE_DIR, 'dist'));
const WRITTEN  = 'https://ogsports1.com';                 // what the files say
const SITE_URL = (process.env.SITE_URL || WRITTEN).replace(/\/+$/, '');
const TODAY    = new Date().toISOString().slice(0, 10);

/* The pages, and the shop's own mark and fonts. assets/ is shared with the
   app rather than duplicated here — two copies of a logo is how a shop ends
   up with two logos. */
const PAGES = ['index.html', 'style.css', 'robots.txt', 'sitemap.xml', 'en'];
const ASSETS = [
  'fonts',
  'icon-192.png', 'icon-512.png', 'logo.svg',
  'instagram-mark.svg', 'telegram-mark.svg'
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });

for (const name of PAGES) {
  cpSync(join(SITE_DIR, name), join(OUT, name), { recursive: true });
}
for (const name of ASSETS) {
  cpSync(join(REPO_DIR, 'assets', name), join(OUT, 'assets', name), { recursive: true });
}

/* Text files only. Rewriting bytes inside a woff2 because they happen to
   spell a domain is not a thing anybody wants to debug. */
const TEXT = /\.(html|xml|txt|css)$/i;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

let changed = 0;
for (const file of files(OUT)) {
  if (!TEXT.test(file)) continue;

  const before = readFileSync(file, 'utf8');
  let after = before.split(WRITTEN).join(SITE_URL);
  if (file.endsWith('sitemap.xml')) {
    after = after.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${TODAY}</lastmod>`);
  }

  if (after !== before) { writeFileSync(file, after); changed++; }
}

console.log(`site: built into ${OUT}`);
console.log(`site: ${SITE_URL}${SITE_URL === WRITTEN ? ' (the default)' : ' (rewritten)'}, lastmod ${TODAY}, ${changed} file(s) touched`);
