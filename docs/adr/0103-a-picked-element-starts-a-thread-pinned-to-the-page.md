# 0103 - A picked element starts a thread pinned to the page

Status: accepted

## Context

Picking an element in the browser opened a small prompt in the page, and **Send** put that prompt into the workstream's open chat (`submit-element-prompt.command.ts`).
The user: "I don't love that I have to add it to the main chat", "it's inline editing and I think inline editing should have its own memorized model", and "whenever I click send it shouldn't start a new tab, it should just start spinning in place, like a gutter of a chat attached to the page location where I left the feedback", collapsed by default, opening "an ephemeral chat tab" only when clicked.
A chat's place in the tab strip and in prompt routing follows `agent_sessions.origin`: everything that picks your chats asks for `origin = 'user'`, and `job` sessions show as a tab only while routed to.
The `origin` CHECK allowed only `user` and `job`, and `agent_sessions` is the parent of seven tables with foreign keys, so a new value needs the table rebuilt with foreign keys off.

## Decision

- **A thread is a session with `origin = 'thread'`.**
  The last migration rebuilds `agent_sessions` with `CHECK (origin IN ('user','job','thread'))`, and `migrate` (`src/main/db/migrations.ts`) now runs every migration with `PRAGMA foreign_keys = OFF` and turns them back on after, as SQLite's table rebuild asks.
  A thread is left out of everything that asks for `user`, as a job is: the tab strip unless routed, prompt routing, `latestSessionForWorkstream`, `chat:turn-finished` and `workstreams_list`.
  Unlike a job, it is named from its first prompt (`sessionAwaitsTitle`), labelled, and calls for attention like your chats.
- **The picker starts it in the main process.**
  `browser.pick-element` takes the remembered model, the models to offer and the run profile (`BrowserPickArgs`).
  The page's composer shows the element, the prompt and a model menu; **Send** spins in place while `startElementThread` (`browser/platform/threads.ts`) stages the screenshot, calls `chat.start-session` with `origin: 'thread'` and `chat.send-prompt` with the element reference, at medium effort, your default access and a low report.
  A thread that does not start keeps the composer open with the reason and your text.
  The renderer remembers the model it started on in `malini.browser.inline-model:v1`, apart from the chat's model.
- **The page carries a pin per thread.**
  `listElementThreads` (`chat.platform.ts`) reads each open thread's status, pending asks, first prompt, element and latest `Outcome:`.
  `BrowserViews.showPins` draws the pins of the page it shows in Malini's isolated world (`thread-pins-page.ts`) on every load, in-page navigation, finished pick and thread event, anchored by DOM path or, when an edit removed that element, by its closest remaining ancestor.
  A pin spins while the thread works and turns amber when it needs you, green when done and red when it failed; a click opens its prompt and outcome with **Open chat** and **Dismiss**.
- **Open chat routes to the thread; Dismiss archives it.**
  The page hands its action back through a long-poll in the isolated world; **Open chat** emits `browser:thread-opened`, and the renderer routes `?agent=` to the thread, which shows as a tab until you leave it.
  **Dismiss** runs `chat.archive-session`, which stops a working thread.

## Consequences

- An element prompt never lands in your chat, and the main composer keeps its model.
- A thread outlives a restart: its pin comes back from the database when its page loads again.
- A thread runs in the workstream's worktree beside your chat, and like any working run it holds back jobs until it ends (`chat.workstream-has-working-run`).
- Every migration now runs with foreign keys off, so a future rebuild of a parent table keeps its children; a migration that relied on a cascade during `DROP TABLE` must delete those rows itself.
- Enforced by `migrations.test.ts` (the rebuild keeps chats, runs, events and packs, takes `thread`, refuses other origins and turns foreign keys back on), `picker.test.ts` and `picker-page.test.ts` (send, spin, retry with the reason, the offered model), `thread-pins-page.test.ts` (pin states, open, dismiss, the closest element left), `views.test.ts` (pins only on their page) and `tests/e2e/browser-tab.spec.ts` "a picked element starts its own thread, pinned where you asked, that opens as its own tab and leaves the main chat alone".
