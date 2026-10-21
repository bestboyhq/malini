# 0031 - The Malini site lives at bestboy.dev/malini

Status: superseded by 0032

## Context

Malini needs a public website and docs that people and LLMs can read.
bestboy.dev is the org's home: a SvelteKit site on Cloudflare in its own repository, and the account behind Grip and the apps that come next.
A subdomain such as malini.bestboy.dev counts as a separate site for search, so it would start with none of bestboy.dev's standing, while a path shares it.
The docs describe features that change with every merge, so they drift unless they change in the same pull request as the code.
Agents increasingly read docs before people do, and HTML wrapped in navigation is a poor input for them.

## Decision

- The site is `apps/site`, a SvelteKit app prerendered with `adapter-static` under `paths.base = '/malini'`, written to `apps/site/build/malini`.
  Every page sets `csr = false`, so it ships no JavaScript.
- A Cloudflare Worker with static assets serves it (`apps/site/wrangler.jsonc`, `worker/index.ts`), on the route `bestboy.dev/malini*` of the bestboy.dev zone.
  Cloudflare sends that path to this Worker and everything else to bestboy.dev's own deployment, so Malini deploys on its own while the URL stays a path.
  `.github/workflows/site.yml` tests the site and runs `wrangler deploy` on every push to main that touches it, once the `CLOUDFLARE_API_TOKEN` secret exists.
- The docs are markdown in `apps/site/content/`, next to the code they describe, one page per file with a `title` and a `description` in its frontmatter.
  `content/reference/events.md` is generated from the contract by `apps/malini/scripts/generate-contract-reference.mjs`.
- LLMs first: every docs page is also served as raw markdown at its URL plus `.md`, `/malini/llms.txt` lists every page in the llmstxt.org format, and `/malini/llms-full.txt` holds all of them, all generated at build from `content/`.
- SEO rules:
  - bestboy.dev owns the one `robots.txt`, and it must list `https://bestboy.dev/malini/sitemap.xml`; the site serves that sitemap.
  - Every page has a canonical link under `https://bestboy.dev/malini`, a meta description and Open Graph tags.
  - The Worker adds `X-Robots-Tag: noindex` on any host other than bestboy.dev, so a `*.workers.dev` preview is never indexed.
  - No trailing slash: SvelteKit's `trailingSlash = 'never'`, assets `html_handling: drop-trailing-slash`, and the Worker answers a trailing slash with a 301 to the path without it.
  - `/malini/_app/immutable/*` is cached for a year as immutable.
  - The site never sets or reads a cookie, and the Worker strips `Set-Cookie`.

## Consequences

- A feature and its docs land in one pull request, and the Update docs job can edit both.
- Malini's release pipeline is untouched: the site deploys from main independently of app releases.
- bestboy.dev must keep the `/malini*` route free, list the Malini sitemap in its `robots.txt`, and may link `/malini/llms.txt` from its own `llms.txt`.
- The base path `/malini` is fixed; moving it means changing `svelte.config.js`, `SITE_URL` in `src/lib/content.ts`, the Worker's immutable prefix and the route together.
- `apps/site/tests/site.test.ts` (`pnpm --filter @malini/site test`, run in CI) fails when `llms.txt`, `llms-full.txt` or the sitemap misses a content page, a page lacks its one canonical URL or description, or the Worker stops adding noindex, the 301 or the immutable cache header.
  Prerendering fails the build on any broken internal link.
