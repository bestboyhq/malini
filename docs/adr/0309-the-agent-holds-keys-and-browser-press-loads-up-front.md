# 0309 - The agent holds keys, and browser_press loads up front

Status: accepted

## Context

In a workstream that builds a racing game on Spawn, the agent pressed `w` four times with `browser_press`, then reported "I can not hold a key, so your lap is the only real drive test."
`pressKey` in `apps/malini/src/lib/browser/platform/automation.ts` sent key-down and key-up back to back, so each press was a tap.
A game that reads which keys are held on each frame sees a tap for one frame at most, so the car barely moves.
`browser_press` also loaded only through tool search (0306), so an agent saw only its name until it searched for it, and the user said that when the agent tried, "it wasnt obvious".

## Decision

- `browser_press` in `packages/agent-bridge/src/claude/browser-tools.ts` takes `holdSeconds`, from 0 to 30 with 0 as the default, the same cap as `browser_wait`.
  Its description tells the agent to click the game first, then hold the key.
- `browser_press` joins the tools that 0306 loads up front, now twelve.
- A `bridge.browser_request` with `action: 'press'` carries `holdSeconds`.
  `decodeBrowserRequest` in `apps/malini/src/lib/chat/platform/agent/protocol.ts` reads a missing value as 0 and refuses one outside 0 to 30.
  The protocol stays at 63, since each side reads the frame of the other.
- `pressKey` sends the key-down events over `Input.dispatchKeyEvent`, waits `holdSeconds`, then sends the key-up events.
  It sends no autorepeat key-downs while the key is held.
- The answer reads "Held w for 2s." in place of "Pressed w.".

This amends 0234 and 0306.

## Consequences

An agent can drive a game that reads held keys, one key per call: it cannot hold two keys at once, such as `w` and `a` to turn while it drives.
A text field gets one character for a held key, not the repeats a real keyboard types.
Every agent call carries one more tool schema.
The bridge waits 60 seconds for each answer, so a 30-second hold and the settle after it fit.
`browser-tools.test.ts` fails when the always-loaded list or the `holdSeconds` schema changes, `protocol.test.ts` fails when the decoder takes a hold outside 0 to 30, and the browser tools test in `browser-tab.spec.ts` fails when the page measures a 1-second hold as shorter than 900 ms.
