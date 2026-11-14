# 0245 - Packaged and dogfood builds count usage on the public Logdash site

Status: accepted

## Context

0058 read the Logdash site from `MAIN_VITE_LOGDASH_SITE`, and 0129 restates that usage counts are silent without it and `MAIN_VITE_LOGDASH_API_KEY`.
Only the release job in `.github/workflows/ci.yml` sets them, from `secrets.MALINI_LOGDASH_SITE` and `secrets.MALINI_LOGDASH_API_KEY`, so every other build inlines both as `undefined` and the sink reduces to `return null`.
The owner runs Malini every day through `pnpm dogfood`, so the bestboy.dev Logdash dashboards, DAU and the L30 chart of 0243 included, never count the person who uses Malini most.
The site ID is public: every shipped bundle carries it, and every bestboy.dev page shows it as `data-site`, from `apps/site/src/lib/logdash.ts`.
The API key is a secret, and this repository is public.
This record replaces 0129's "silent without `MAIN_VITE_LOGDASH_SITE` and `MAIN_VITE_LOGDASH_API_KEY`"; the rest of 0129 stands.

## Decision

- `src/lib/app/platform/usage-data.ts` holds the bestboy.dev Logdash site, `6ad7c3d3d519015fcd43194b`, as `LOGDASH_SITE`.
- `logdashSink` sends usage counts to `MAIN_VITE_LOGDASH_SITE` when the build sets it, and otherwise to `LOGDASH_SITE` only in a packaged build (`!context.isDev`) or in the dogfood window.
- The dogfood window is `isDogfoodWindow` in `src/main/url-scheme.ts`: `MALINI_DOGFOOD=1`, which `scripts/dogfood.mjs` sets, without `MALINI_BACKGROUND_WINDOW=1`; `claimsUrlScheme` uses the same check.
- A plain `pnpm dev`, unit tests, the e2e harness, `test-malini-app` and every background launch send nothing.
- The release job keeps passing `secrets.MALINI_LOGDASH_SITE`, which overrides the default.
- `MAIN_VITE_LOGDASH_API_KEY` still comes only from the build environment and is never committed, so a dogfood build sends usage counts and no error names.
- `MALINI_USAGE_DATA=off`, `DO_NOT_TRACK=1` and **Share usage stats** still stop every call.

## Consequences

- The dogfood Malini counts toward DAU, L30 and the journey markers like a release, under the signed-in account or its install ID (0243).
- Dogfood counts are not marked apart from release counts on the dashboard.
- A local `pnpm dist` build is packaged, so it counts too.
- Moving to another Logdash site needs a commit for dogfood and local builds; the release secret moves only releases.
- Enforced by `src/lib/app/platform/usage-data.test.ts` ("posts to the public site from a packaged or dogfood build with no site configured, never from a plain dev run") and `src/main/url-scheme.test.ts`.
