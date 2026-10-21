# 0044 - Workstream images and videos stream over one protocol

Status: accepted

## Context

0025 served only PNG, JPEG, GIF and WebP over `malini-image://`, each read whole into memory up to `MAX_PREVIEW_BYTES`.
Users now attach screen recordings (mp4, mov, webm) of up to 100 MB, and asked for Malini to play them.
A `<video>` element seeks with HTTP range requests, and Chromium streams media from a custom scheme only when that scheme has the `stream` privilege.
Reading a 100 MB recording whole for every range request, or copying it over IPC as 0025 replaced, would hold it in memory for nothing.
Opening the gallery on a chat with 792 images froze the window for over a second, and 582 of those images sat in `/tmp`, so each one ran 0022's event scan on every request.

## Decision

- `malini-image` keeps 0025's URL, registration and 0022's path checks, and adds `stream: true` to its privileges (`src/lib/shared/repositories/platform/image-protocol.ts`).
- `workstreamMediaResponse` (`images.ts`) reads a file's first bytes: PNG, JPEG, GIF and WebP are read whole as before; an ISO BMFF `ftyp` box (`video/quicktime` for brand `qt  `, `video/mp4` otherwise) or the WebM signature streams from the open file in 256 KiB chunks.
- A video answers `Range: bytes=` with `206` and `Content-Range`, a range past its end with `416`, and no range with `200` and `Accept-Ranges: bytes`; any other bytes answer `404`.
- Videos have no size cap on this path; images keep `MAX_PREVIEW_BYTES`.
- The renderer's CSP adds `media-src 'self' blob: malini-image:` (`src/renderer/index.html`).
- A gallery item carries `media: 'image' | 'video'`; the gallery plays a video with native controls, muted, autoplaying and looping, and the composer's hover card plays it muted.
- A confirmed `agentHasReadFile` answer is remembered per workstream and path for the app's lifetime, so a repeated request skips the event scan.

## Consequences

- Seeking works, and a long recording never sits whole in memory.
- The scheme now serves videos as well as images, still only what 0022's checks allow.
- A video the agent read outside the worktree is served too; agents see videos through ffmpeg frames, so in practice videos come from attachments inside the worktree.
- A remembered agent read outlives a forgotten chat until the app restarts, as the `ponytail:` note in `image-protocol.ts` says.
- Enforced by `images.test.ts` for the signatures, ranges, `206` and `416`, and by `tests/e2e/image-gallery.spec.ts`, which plays a sent mp4 to `readyState` 2 in the gallery.
