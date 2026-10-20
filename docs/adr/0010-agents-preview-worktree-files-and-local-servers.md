# 0010 - Agents preview worktree files and their own local servers

Status: accepted

## Context

Agents prove UI work by opening a page in Malini's browser with `browser_open` and capturing it with `browser_screenshot`.
The browser opened only `http` and `https` pages, so a file the agent had just written in its worktree could not be shown without a server.
In the default `sandboxed` access, Claude Code's sandbox refuses to bind localhost ports, so the server an agent started died with `PermissionError: [Errno 1] Operation not permitted` and `browser_open` failed with `ERR_CONNECTION_REFUSED`.
The user reported that agents hit these failures too often.
`file://` is not an option: Electron's `GrantFileProtocolExtraPrivileges` fuse is on, and Malini needs it because the packaged renderer loads from `file://`, so a `file://` page could fetch any file on disk.

## Decision

- The browser partition serves worktree files over the private `malini-worktree` scheme (`BROWSER_WORKTREE_SCHEME` in `src/contract/browser.ts`), declared privileged as `standard` and `secure` before the app is ready (`src/main/index.ts`).
- Each workstream is its own origin, `malini-worktree://<workstream id, lowercased>/<path>`, so a page reads only its own worktree.
- `browser_open` and the address bar take an absolute path, a path starting with `./` or `../`, or a `file://` URL, and open it on that origin when it lies inside the worktree (`src/lib/browser/platform/url.ts`).
- The handler (`src/lib/browser/platform/worktree-files.ts`) resolves symlinks and serves a regular file inside the worktree, or a folder's `index.html`, and nothing else.
- A page from the web, or from another worktree, cannot navigate, redirect or open a window into a worktree origin.
- Sandboxed agent commands may bind localhost ports (`allowLocalBinding` in `packages/agent-bridge/src/claude/permissions.ts`).
- `browser_open` on a localhost address waits up to 20 seconds for a server that is still starting.

## Consequences

- A static page needs no server, so no background command keeps the run open for it (0009).
- A dev server the agent starts in the sandbox answers on localhost, where Malini's browser and any other local process can reach it.
- A page served from a worktree can read every file in that worktree, as a local dev server would.
- Enforced by `url.test.ts`, `worktree-files.test.ts` and `views.test.ts` in `src/lib/browser/platform`, `permissions.test.ts` in the agent bridge, and `tests/e2e/browser-tab.spec.ts`, which opens a worktree file and follows its link.
