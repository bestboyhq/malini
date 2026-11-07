# 0175 - A docs section leads with a live demo

Status: accepted

## Context

The docs are markdown first, for LLMs as much as for people (ADR 0031), and every feature adds its lines to its page in the same pull request.
The Chat page grew to about 6,000 words, and the user said people won't get through that much text.
The landing page already runs the real renderer on demo data in iframes (ADR 0119), so a demo can show a feature without a hand-built mock-up that drifts from the app.
LLMs still need every word, so the text cannot move out of the markdown.

## Decision

- A docs section opts in with a directive right under its `##` heading in `apps/site/content/`:

  ```markdown
  <!-- demo <workstream id> <height>
  <one lead line, inline markdown>
  - <a Try line>
  -->
  ```

- `renderDoc` in `apps/site/src/lib/content.server.ts` turns each directive into a demo block, with the section's text up to the next `h2` as `more`.
  `src/lib/DocDemo.svelte` draws the lead, the real renderer from `demo/app?play=docs#/workstreams/<id>` at the given height on the landing's lit stage, the Try lines as chips, and the full text folded under **The long version · N words**.
  The frame keeps the app at its own size and scales it down only below 600px.
- `withoutDemos` drops the directives from each page's `.md` twin and from `llms-full.txt`, which keep the full text; the page HTML keeps it too, inside `<details>`.
- A link into a folded section opens the fold (`revealTarget` in `src/routes/(site)/docs/[...slug=page]/+page.svelte`).
- `?play=docs` in `apps/malini/src/renderer/demo` does the following:
  - It lists the scene workstreams from `demo-docs.ts` and hides the top bar's right side and the inspector.
  - It clears each scene's saved draft and queue, seeds its draft, and follows the site's `theme` as it changes.
  - A scene's live turn plays once half its frame is in view.
  - A prompt the reader sends gets its scripted reply from `DOCS_REPLIES`, or the demo's default reply.
  - **⌘↵** and the stop square cancel the running turn.
- A wheel the demo cannot scroll scrolls the page once: `passScrollToTheSite` cancels the wheel it passes on, so the browser does not chain it too.

## Consequences

- A section shows what it does in the real app, and its long text stays one click away and complete for LLMs and search.
- A new demo needs a scene in `demo-docs.ts` that keeps up with the renderer, and a change to the demo build changes the Open Graph source hash, so `pnpm --filter @malini/site generate:og-image` reruns.
- Every demo loads the full renderer in its own frame, lazily, so a page with many demos weighs more.
- `apps/site/tests/site.test.ts` fails when a page's frames differ from its directives, a directive names a workstream the demo build lacks, or a directive reaches a `.md` twin or `llms-full.txt`.
  Nothing checks that a Try line matches what its scene can do.
