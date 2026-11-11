# 0222 - A report runs only the page you look at

Status: accepted

## Context

Reports show HTML variants as live pages in iframes (0048, 0128), served over `malini-worktree://` (0010).
Each page variant ran twice, once in the report's frame and once in its tab's thumbnail, and every variant ran in the frame even while another one showed.
The user felt frame drops while they scrolled their chats.
On their 25-turn chat with 69 live pages, Malini's main renderer thread was busy for 7.8 s of a 12 s scroll, against 0.7 s for a chat with no pages.
Every iframe runs in that one renderer process, so each page's layout, scripts and animations cost the transcript frames.
Nothing in Malini could take a picture of a page outside the browser tab.

## Decision

- `ReportStage.svelte` mounts a page variant's frame only while its tab shows; a hidden variant keeps its place but runs no page.
- `ReportMedia.svelte` runs a page live only at `size="hero"`; every `tile` and `mini` of a page, in a report's tabs, a pick, `PickStep` or the gallery's strip, is an `<img loading="lazy">` of its still.
- `pageStillUrl` in `apps/malini/src/contract/browser.ts` names a page's still as its `malini-worktree://` URL with a `malini-still` query that carries the fragment; `stillPageUrl` reads it back.
  `src/renderer/index.html` allows `malini-worktree:` in `img-src`.
- `serveWorktreeFiles` answers a still request on the default session alone, after the same `worktreeFile` check as the page, with a JPEG and `Cache-Control: no-store`; the browser tab's session serves only pages.
- `pageStills` in `apps/malini/src/lib/browser/platform/page-stills.ts` takes the still.
  It loads the page at 1280 × 800 in a hidden, sandboxed `WebContentsView` on the main window, on the default session so the page gets the same served bytes as its frame, muted, with no new windows and no navigation.
  It waits for the page to load, its fonts and 400 ms, captures it with `captureFrame`, and keeps a 640 px wide JPEG under `<appData>/page-stills/<workstream>/`, named by the page URL and the light or dark theme.
  A still stays while it is newer than its page file; captures run one at a time, and two requests for one still share its capture.
- `registerBrowser` removes a workstream's stills when the workstream is removed.

## Consequences

- The same chat runs 5 live pages instead of 69, and its main renderer thread is busy for 2.2 s of the scroll instead of 7.8 s.
- A thumbnail shows the page once it settles: entrance motion that runs past 400 ms shows mid-way, and a page that loads past 10 s shows what it painted by then.
- A still follows its page file's own time, so a change only to a stylesheet or script the page loads keeps the old still; the `ponytail:` comment in `page-stills.ts` names it.
- A chat with many new pages fills its thumbnails one after another, since captures run one at a time.
- The first look at a page costs one hidden page load in the main process; later looks read a file.
- "variants preview as pictures, looping recordings and live HTML pages" in `tests/e2e/report-media.spec.ts` fails when a hidden variant runs a page, when its tab shows no loaded still, or when a thumbnail runs a page; `browser.test.ts` pins the still URL's round trip.
