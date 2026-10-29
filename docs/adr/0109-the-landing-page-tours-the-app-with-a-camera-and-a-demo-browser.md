# 0109 - The landing page tours the app with a camera and a demo browser

Status: accepted

## Context

The user asked for a landing card that shows you can chat at any resolution: above every organization and private repository, in one workstream, or about one element in its browser.
After three rounds of drawn variants they picked the breadcrumb one, then asked for the sidebar to lead, for "a normal app" seen "slightly zoomed in", and for it to "look like an actual app".
0108 already runs the real renderer on demo data, but a 620 by 480 card shows a 1280 by 860 window too small to read, and the demo had no Home chat script and no browser.
In the real app the browser page is a native `WebContentsView` drawn by the main process, and the element picker and pins are scripts the main process injects into that page (0107), so the renderer alone shows an empty rectangle.
The demo cannot import those page scripts: `src/lib/browser/platform/` is main process code, and `@malini/desktop/domain-boundaries` forbids a renderer import of it.

## Decision

- `app.html?play=tour` plays `demo-tour.ts`: the drawn cursor clicks **New chat** at Home in the sidebar, types one prompt for every site, and the chat starts a workstream in malini, grip and tony from `demo-tour-data.ts`.
  The cursor opens tony's workstream, whose agent opens `http://localhost:5173` in a browser tab; it presses **Pick an element**, picks the footer's Changelog link, types detailed feedback and sends it.
  The thread's pin turns green when its run completes, the link turns quiet on the page, and the pin's **Open chat** opens the thread as a tab.
- `demo-live.ts` plays a chat above repositories from a `LeadScript`, the organization one of 0108 or the Home one of the tour, picked by the prompt.
  A started workstream with `opens` opens its page near the end of its work, and `startThread` adds a session with `origin: 'thread'` to `chat.list-sessions`.
- `demo-browser.ts` stands in for the native view.
  It answers the `browser.*` commands, emits `browser:tab-opened` and `browser:state-changed`, and paints Tony's page in a shadow root at the bounds of `browser.show`, above the app as a native view is, hidden on `browser.hide`.
  `browser.pick-element` draws its own hover box, tag, hint and composer, then a pin with a card, in the look of `picker-page.ts` and `thread-pins-page.ts`, and resolves with the thread it started.
- The camera lives in the site.
  The tour posts `malini-demo:camera` with the rectangle to frame, and `DemoTour.svelte` scales and moves the 1280 by 860 iframe to fit it, between the whole app and 1.5 times, never past the app's edge, through `cameraFor` in `apps/site/src/lib/camera.ts`.
  The tour repeats `malini-demo:ready` with its current shot until the card answers `malini-demo:play`, which it sends once 60% of the card is in view; a lazy iframe boots before the page around it hydrates, and inside a zoomed card the iframe never sees itself 60% in view.
- The landing page shows it as the Chats row after Browser, "Chat at any resolution.", starting on `ws-tony-hero`.
- `demo-cursor.ts` holds the drawn cursor both scripts drive.

## Consequences

- The card is the real sidebar, chat, inspector and thread tabs, so it changes when the app does.
- The demo's picker and pins are copies of the main process's look, and they drift when `picker-page.ts` or `thread-pins-page.ts` change; nothing fails when they do.
- The tour finds the app by `sidebar-new-chat-row`, `chat-composer-input`, `chat-composer-submit`, a sidebar row's `data-workstream-id`, the "Pick an element" button and the `chat-agent-tab` of a `thread-` session, so renaming any of them stalls it at that step.
- A focus inside the iframe must pass `preventScroll`, or it scrolls the landing page to the card.
- `apps/site/tests/camera.test.ts` covers the camera's fit, its clamp at the app's edge, and which shots it accepts.
