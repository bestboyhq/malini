# 0025 - Workstream images load over a protocol

Status: superseded by 0044

## Context

Every image in the transcript reached the renderer through `repositories.read-workstream-image`: the main process read the bytes, structured clone copied them over IPC, and the renderer wrapped them in a `Blob` and an object URL.
Images in markdown were requested as soon as their message rendered, so opening a busy chat pulled every image's bytes through IPC whether or not it was on screen.
The browser could neither lazy-load nor decode those images off the main thread, and it could not cache them by URL.
The renderer is sandboxed (0002) and may only see images that 0022 allows.

## Decision

- The main process registers the privileged `malini-image` scheme once, in `src/main/index.ts`, next to `malini-worktree` (0010), and serves it with `serveWorkstreamImages` (`src/lib/shared/repositories/platform/image-protocol.ts`) on the default session only, so browser tabs cannot reach it.
- A URL is `malini-image://workstream/<workstream id>/<path>?v=<version>` (`src/contract/workstream-images.ts`); the version changes when the file does.
- Each request goes through `readWorkstreamImage` with `agentHasReadFile`, the same checks as 0022: the path stays in the worktree or was read by that workstream's agent, no symlink as the last component, at most `MAX_PREVIEW_BYTES`, and PNG, JPEG, GIF or WebP bytes, sent with `x-content-type-options: nosniff`.
- Transcript images use `loading="lazy"` and `decoding="async"`; the renderer's CSP allows `img-src malini-image:`.
- `repositories.read-workstream-image` stays, and runs only when an image fails to load, to explain why.

## Consequences

- Off-screen images cost nothing, and Chromium decodes and caches the rest.
- The scheme is a second way for the renderer to read main-process data besides `window.malini`; it serves only images, and only what `readWorkstreamImage` allows.
- Any new place that shows a workstream image must build its URL with `workstreamImageUrl`, not read bytes over IPC.
- Enforced by `images.test.ts` for the path checks, `tests/e2e/transcript-rendering.spec.ts`, which loads a lazy markdown image, and `tests/e2e/image-gallery.spec.ts`.
