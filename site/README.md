# site/ — the public page

**This is not the shop.** The shop's own system — till, stock, customers,
money — runs on the laptop in Aleppo and is reached at `shop.ogsports1.com`;
it is `noindex` and always will be. What is in this folder is the other thing
entirely: the page a customer or a search engine lands on, at the apex domain,
deployed to the VPS as its own container.

Two pages, one stylesheet, the shop's own mark and fonts. No framework, no
bundler, no JavaScript on the page at all.

```
site/
  index.html      Arabic — the canonical page
  en/index.html   English
  style.css       the shop's skin, cut down to what one page needs
  robots.txt      Allow, including the AI crawlers, and the Sitemap: line
  sitemap.xml     both pages, as alternates of each other
  build.mjs       assembles dist/: points every link at SITE_URL, stamps lastmod
  nginx.conf      the server block — gzip, caching, SPA fallback, /healthz
  Dockerfile      node builds → nginx:alpine serves
```

## Run it

```bash
node site/build.mjs            # -> site/dist/, open it with any static server
docker build -f site/Dockerfile -t og-site .
docker run --rm -p 8080:8080 og-site
```

## Deploy it

Its own Coolify resource, same repository:

| setting | value |
|---|---|
| Dockerfile location | `/site/Dockerfile` |
| Base directory | `/` — the build context is the repo root, because the page uses `assets/` |
| Port | `8080` |
| Domain | `https://ogsports1.com` |
| Build argument | `SITE_URL=https://ogsports1.com` |

**`SITE_URL` is the one thing that must be right.** Every absolute link, the
canonical, the three `hreflang` lines, both Open Graph urls, both structured
data `@id`s and both sitemap entries are written for `https://ogsports1.com`;
the build rewrites them all if you build for another domain. A canonical
pointing at a domain that does not answer tells Google to index nothing.

Then, once it answers:

1. **DNS** — the apex and `www` at the VPS. Pick one and redirect the other;
   two live copies of one page split its ranking.
2. **Google Search Console** — add the property, submit
   `https://ogsports1.com/sitemap.xml`. This is the step that actually gets it
   into Google.
3. **Bing Webmaster Tools** — the same sitemap. Bing's index is what several
   AI assistants read.
4. **Google Business Profile** — for "sports shop in Aleppo" this matters more
   than the site does. Claim the pin the page already links, and make the name,
   the city and the Instagram link match the page exactly. An assistant asked
   where to buy sportswear in Aleppo answers from the map listing and the page
   agreeing with each other.
5. **Instagram and Telegram** — put the domain in both bios. `sameAs` claims
   the link; a link back from the profile proves it.

## What the page deliberately does not say

Three things are missing because nobody has supplied them, and inventing them
would be worse than leaving them out — a wrong address in a search result sends
customers to somebody else's door:

- **the street and district** (`shop.address` in the database is still
  `Aleppo, Syria`),
- **the phone number**,
- **opening hours**.

All three belong in the JSON-LD block in both pages (`address.streetAddress`,
`telephone`, `openingHoursSpecification`) and are what turn the page from "a
shop in Aleppo" into a listing Google can put on a map.

There is also **no rating and no review block**, on purpose: an invented star
rating is the single fastest way to get a business page distrusted by both
Google and the assistants reading it. Real ones can be published from the
shop's own `order_reviews` once there are enough.
