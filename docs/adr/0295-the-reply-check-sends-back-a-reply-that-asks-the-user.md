# 0295 - The reply check sends back a reply that asks the user

Status: accepted

## Context

ADR 0294 tells the agent to ask its questions with `AskUserQuestion` in the question panel, never in its reply, but only the instructions say so.
The user saw that "our agents not always put questions to the question panel and we should definitely encourage it more".
The local history agrees: from November 1 to 22, 14 runs called `AskUserQuestion`, and about 435 replies asked in text, mostly as `Needs: your go on ...`, "Say go and I'll build it." or "If you want, I can ...".
ADR 0178 already has the provider's small model read each reply in a `Stop` hook and send a failing one back once, but it registered the hook, and held the reply, only while **Plain replies** is on.

## Decision

- The bridge registers the `Stop` hook in `packages/agent-bridge/src/claude/session.ts` on every query, and `ClaudeTranscript` holds the last top-level reply on every run, so a sent-back reply never stays in the chat.
- `replyCheckInstructions(ste, terse)` in `reply-check.ts` always carries a question rule: a reply fails when it asks the user to answer, decide, choose, confirm, approve or say go on anything, in its prose, a `Next:` line or a `Needs:` line.
  `Needs: nothing` passes, and so does a variant pick of the variants the reply embeds, a secret, a sign-in, an access grant, a file to fill in or a command the reply gives.
  Each failed question comes back quoted with "Ask it with AskUserQuestion, or decide it yourself and say which way you went."
  The STE and length rules join it only while **Plain replies** is on, and the checker checks only the rules it gets.
- With **Plain replies** off, `mayAskUser(reply)` decides first whether the reply goes to the small model at all: a `?` that ends a sentence, a `Needs:` line other than `nothing`, a `Next:` that starts with a word such as decide or confirm, or a phrase such as "say go" or "if you want", with code, inline code and links taken out first.
- The `<malini>` instructions tell the agent that a small model sends back a reply that asks the user anything.

## Consequences

- An agent that asks in text gets one more turn to move the question to the panel or decide it, and the user sees only that rewrite.
- With **Plain replies** off, a reply the prefilter flags waits about three to five seconds for the check, which was about half the replies in the history; the rest settle at once.
- A reply that asks with words the prefilter does not know goes through unchecked, and the small model can pass a borderline ask, such as "Your call on copy" beside a settled plan.
- Since the transcript always holds the last reply, ADR 0178's note that a background agent's message between a reply and its check shows both now holds with the switch off too.
- Enforced by `reply-check.test.ts` (what `mayAskUser` sends to the check and lets through), `session.test.ts` (a plain reply that asks goes to the check and is sent back, one that asks nothing is not checked) and `transcript.test.ts` (the chat shows only the rewrite).
  Nothing checks the small model's verdicts; the real check on 20 replies from the history sent back 10 that asked, passed every variant pick, sign-in and command, and passed 2 borderline asks.
