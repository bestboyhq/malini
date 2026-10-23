# 0059 - Logdash events name their app and platform

Status: accepted

## Context

0043 had the site track `download_started` in bestboy.dev's Logdash site, the one every Bestboy product reports to.
`bestboyhq/platform` tracks `download_started`, `app_signed_in`, `video_played`, `comment_posted` and more there under the same bare names, so Malini's events read as anyone's.
The user asked for every event to carry its app and platform: "it should be like malini_desktop_<event>".
The rest of 0043 still holds: the Worker's `/malini/_ld/` routes, the site ID in `apps/site/src/lib/logdash.ts`, production-only loading and the batch checks.

## Decision

- Every custom Logdash event Malini sends is named `malini_<platform>_<event>`, in snake case.
  The platform is `web` for the site and `desktop` for the app.
- The site tracks `malini_web_download_started` with `{ app: 'malini', menu: 'malini-<place>' }` from the one document click listener in `apps/site/src/routes/+layout.svelte`.
  The place is the nearest `data-place`: `bar`, `hero`, `closing`, `footer` or `docs`, and `page` when none.
- `apps/site/src/app.d.ts` types `window.logdash.track`'s name as `` `malini_web_${string}` ``.
- The Worker, the shared site ID and the script loading stay as 0043 set them.

## Consequences

- Malini's site events no longer mix with bestboy.dev's own `download_started` in Logdash, which keeps it under its old name.
- Downloads counted before the change stay under `download_started` with `malini-*` menus; a report that spans the change reads both names.
- `pnpm check` fails when the site tracks a name without the `malini_web_` prefix.
- Nothing checks the app's `malini_desktop_` prefix; its event names live next to its Logdash sink.
