# 0069 - Markdown files open rich, in readsimon's prose

Status: accepted

## Context

Every File tab showed its file as CodeMirror source (0064), so a Markdown document read as raw text with line numbers and `#` marks.
The user asked for "a raw version of it or a rendered, rich version of it" with a switch, the rich one following the prose of readsimon.com "because it's so clean and minimalistic, easy to read".
A first version put the switch on a row of its own above the file, and the user hated "that we're pushing the whole editor with this first row".
That prose lives in `szymeo/simn.so`, in `src/styles/prose.css` and `src/styles/markdown.css`, set in Inter, with STIX Two Text for quotes.
The repository extension reaches Malini only through `@malini/extension-api`, which had no way to show a worktree image, and the renderer's CSP (`img-src 'self' data: blob: malini-image:`) blocks every remote image.
Tailwind emits only the theme variables the app uses, so the unused `--font-display` never reached the page and neither font was bundled.
Malini routes on the URL hash, so a `#heading` link that reached the window would navigate the app away from the workstream.

## Decision

- `.md` and `.markdown` File tabs get a **Rich** / **Raw** switch, a `role="group"` named `Show <file> as` with `aria-pressed` buttons, and open **Rich**.
  The switch floats over the tab's top-right corner and never takes a row: **Raw** starts at its first line like any other file, and **Rich** keeps 48 px of space above its text for it.
  Text scrolls under the switch through a fade over the top 48 px, always on in **Rich** and, in **Raw**, a scroll-driven CSS animation that grows it over the first 48 px of scroll, so line 1 stays clear at rest.
  CodeMirror's `scrollMargins` treats those 48 px as covered, so the cursor line never hides in the fade.
  A file opened at a line opens **Raw**, and each path keeps the view the user left it in until the extension stops.
- CodeMirror stays mounted and stays the source of truth: **Raw** shows it, **Rich** hides it and renders its text, again after every change from disk or from typing.
  Saving, following the file on disk and the branch marks work as before.
- Switching keeps the reading position.
  Each top-level block of the rich article carries `data-source-line`, the line it starts at in the file, and the line 3 rem below the top of one view lands 3 rem below the top of the other, through `markdownLineAt` and `markdownLineTop` on the rich side and CodeMirror's `lineBlockAtHeight` and `scrollIntoView` on the raw side.
- `extensions/repository/src/markdown.ts` renders with `marked` (GFM) and sanitizes with DOMPurify, the versions the app already uses.
  It drops YAML front matter and colors fenced code with the extension API's tokenizer.
- Every click on a link is caught: `http(s)` opens through `ui.openExternal`, `#heading` scrolls to the heading GitHub would anchor it to, and a relative path opens its file through `malini.repository.open-file`; any other link does nothing.
- The optional `ExtensionAPI.workstream.mediaUrl(path, workstreamId?)` returns a `malini-image://` URL (0044) for a worktree file, which the desktop host builds with `workstreamImageUrl`.
  A remote image, or one the worktree cannot serve, reads as its alt text.
- Images load as soon as the article renders, never lazily, even when the file's own HTML asks for `loading="lazy"`.
  An image without `width` and `height` takes no space until it loads, and a lazy one loads only as it scrolls into view, so scrolling up to it shoved the text below down by its whole height: the browser's scroll anchoring picked the image's own paragraph as its anchor and held still.
  Loaded at render, an image above the view grows out of sight, scroll anchoring keeps the text in place, and a re-render reuses the loaded image at full size.
- `MARKDOWN_ARTICLE_STYLES` ports readsimon's prose onto Malini's tokens: a 680 px column, 16/28 px Inter Variable with optical sizing, headings at 550 weight near body size, Georgia italic emphasis, STIX Two Text italic quotes behind a 3 px `--color-surface-invert` bar, and code wells half way between `--color-surface-50` and `--color-surface-100`.
- `src/renderer/src/app.css` imports `@fontsource-variable/inter/opsz.css` and both styles of `@fontsource-variable/stix-two-text`; the browser fetches a face only when rendered text uses it.

## Consequences

- Docs, plans and READMEs read like an article, and their text is one click from editing.
- A Markdown tab holds its editor and its rendered article at once, and re-renders the whole file on each change.
- A Markdown file fetches all its worktree images when it first shows **Rich**, not only the ones the reader reaches.
- No click inside rendered Markdown navigates the window or loads anything from the network.
- A scroll-driven animation stays `running` for as long as its scroller lives, so every wait for motion to stop counts only animations on `document.timeline`: onboarding's `somethingMoves`, `settleAnimations` and `untilStill` in the e2e harness, and `shot` in the `test-malini-app` skill.
  Without that, onboarding's rehearsal would spin forever behind an open **Raw** tab.
- `.mdx` files stay raw: JSX would render as stray text.
- Extension CSS works only with variables the app emits; the Files panel's `--color-surface-200` and `--color-accent-2-primary` never reached the page, so they became `--color-surface-150-hover` and `--color-warning-content`.
  Nothing enforces this.
- Enforced by `markdown.test.ts` (links, heading anchors, sanitizing, front matter, images and their eager loading) and `file-tab.test.ts` (**Rich** first, a line opens **Raw**, the view is remembered) in the repository extension, and by `tests/e2e/file-editing.spec.ts`, which opens a Markdown file in **Rich**, edits it in **Raw**, sees the edit in **Rich**, follows its link to another file, and switches a long file both ways without losing its section.
