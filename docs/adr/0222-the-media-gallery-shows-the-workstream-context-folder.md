# 0222 - The Media gallery shows the workstream's `.context` folder

Status: accepted

## Context

Agents save every screenshot, recording and prototype under `.context` in the worktree (ADR 0045, ADR 0051).
The user saw them only when a report embedded them, or by digging through the Files tree.
The user asked for a **Media** row in the inspector gutter with a count of the media files, and for a click to show a gallery grid, "categorized in a modal, like videos, audio, documents", as "a reflection of the `.context` directory in the workstream".
`malini-image://` served only PNG, JPEG, GIF, WebP and video (ADR 0044), so audio and SVG answered `404`.
The browser's worktree scheme sent a CSV as `text/csv`, which Electron downloads, and sent text without a charset, which Chromium decodes as windows-1252.

## Decision

- `contextMediaCategory` in `apps/malini/src/contract/workstream-images.ts` sorts a path by its extension into five categories.
  Images are png, jpg, jpeg, gif, webp and svg.
  Videos are mp4, m4v, mov and webm.
  Audio is mp3, m4a, wav, ogg, oga, flac and aac.
  Pages are html and htm.
  Documents are pdf, md, markdown, txt, csv and json.
  Any other file is not media, and `mediaKind` is unchanged.
- The command `repositories.workstream-context-media` runs `listContextMedia` in `apps/malini/src/lib/shared/repositories/platform/context-media.ts`.
  It walks `<worktree>/.context` with `readdir(withFileTypes)`, goes into real folders only, and lists regular files only.
  It never follows a link, because Node's recursive `readdir` follows linked folders.
  It lists nothing when `.context` is missing, is a file, or is a link.
  Each item carries its worktree-relative path, size, `modifiedAt` and category, newest first, capped at 1000 with a `ponytail:` note.
- `workstreamMediaResponse` in `apps/malini/src/lib/shared/repositories/platform/images.ts` sniffs the first 1 KiB.
  MP3 (ID3 or a frame header), AAC (ADTS), M4A (`ftyp` brand `M4A ` or `M4B `), Ogg, FLAC and WAV stream with `Range` support, as video does.
  A file whose bytes open an SVG document is served as `image/svg+xml` with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`.
  `imageMediaType` still never returns SVG, so `repositories.read-workstream-image` and avatars still refuse it.
  The renderer's CSP already allows `malini-image:` for `img-src` and `media-src`, and is unchanged.
- The gallery shows an SVG through an `<img>` on its `malini-image://` URL, versioned by `modifiedAt`.
  An `<img>` never runs an SVG's scripts or loads its resources, and the CSP header covers a direct load.
  The `malini-image://` URL also makes `mediaKind` read the SVG as an image, not as a page in a frame.
- `served` in `apps/malini/src/lib/browser/platform/worktree-files.ts` sends md, markdown, txt, csv and json as `text/plain; charset=utf-8`.
  A CSV shows in the tab instead of downloading, and UTF-8 text reads right.
  A PDF keeps `application/pdf` and opens in Chromium's PDF viewer.
- The renderer slice lives in the `chat` domain, which owns report media, `MediaViewer` and `WorkstreamMedia`.
  It holds `context-media.service.ts`, `context-media.aggregate.svelte.ts`, `load-context-media.command.ts`, the `context-media-listing` and `context-media-count` queries, and `keep-context-media-fresh.hook.ts`.
- `WorkstreamPage.svelte` loads the list when the page opens.
  It reads again when `repositories:workstream-files-changed` names a path under `.context`, or names no paths because it lost count.
  The watcher already waits for 250 ms of quiet and at most 2 s, and the latest read wins.
  When a later read fails, the gallery keeps the last list.
- `WorkstreamPage.svelte` adds the panel action `media` with the file count, so the gutter hides the row at zero (ADR 0221).
  Its icon is the new `image` glyph, mapped from `media` in `ExtensionPanelIcon.svelte`.
- `MediaGallery.svelte` is a modal named **Media**.
  Its tabs are **All** and each category that has files, with their counts, as `role="tab"` with `aria-selected` and arrow keys.
  Its grid lists the shown files newest first, each with its name, its subfolder and its age.
  Image and video tiles reuse `WorkstreamMedia` at `tile` size, an audio tile plays in place with native controls, and page and document tiles show the file type icon.
  An image, video or page opens `MediaViewer` over the shown images, videos and pages.
  A document closes the gallery and opens in a new inspector browser tab at `worktreePageUrl`.

## Consequences

Everything an agent saved for a workstream is one click from the chat, sorted by kind, without a report that embeds it.
The gallery shows what `.context` holds, not what a chat showed, so a capture saved elsewhere, such as `/tmp`, does not show.
A file of any other type, such as a log or a zip, does not show, and a `.context` with more than 1000 media files shows its newest 1000.
The browser tab now shows text documents as plain text anywhere in a worktree, not only in `.context`.
What must stay true: the lister never follows a link, SVG is never served without its CSP, and `imageMediaType` never returns SVG.
`apps/malini/src/contract/workstream-images.test.ts` covers the categories.
`apps/malini/src/lib/shared/repositories/platform/images.test.ts` covers the audio and SVG signatures, a `206` for audio, and the SVG's CSP.
`apps/malini/src/lib/shared/repositories/platform/context-media.test.ts` covers the order, the categories, files outside `.context`, and links to files and folders inside and outside the worktree.
`apps/malini/src/lib/browser/platform/worktree-files.test.ts` covers the text types, and `apps/malini/src/lib/chat/domain/context-media.test.ts` covers when the list reads again and the tab counts.
`apps/malini/tests/e2e/media-gallery.spec.ts` covers the flow in the app: the count, the tabs, an SVG and an audio file that load, the viewer, a document in a browser tab, a new file that raises the count, and no row for a `.context` with no media.
