# 0093 - A limit or an outage pauses a run, and Malini continues it

Status: accepted

## Context

A user's Claude usage limit ran out while Malini merged their work: the fix job failed, Malini ran it twice more in under a second, stopped with "Fix gave up", and nothing they wrote in the chat or in the job moved it.
The bridge flattened every failure into one error string (`resultError` in `packages/agent-bridge/src/claude/session.ts`), although the SDK reports what failed: an error kind on the assistant message (`SDKAssistantMessageError`), the HTTP status (`api_error_status`) and, for a Claude plan, a `rate_limit_event` with the time its limit resets.
Claude Code already tries again up to 10 times on an overloaded or failing API, a lost connection or an API-key rate limit, but ends the turn at once on a plan's usage limit, so a failure that reaches Malini has outlasted Claude Code's own retries or waits on a reset.
The user: "the moment you hit an error with your cloud run or service is unavailable or service is overloaded or something like that, I think that's the moment you're cooked", asking for backoff or a scheduled wake-up so they are not bothered, and for "a robust approach" across subscriptions, API keys and custom endpoints.
Malini already paused a turn a quit cut short and continued it on the next start through the Resume rule (0085), so a paused turn was a known shape.

## Decision

- **The bridge says what failed.**
  `run.failed` carries `failure: { kind, resetsAt?, status? }` (`RunFailure` in `packages/agent-bridge/src/types.ts` and `src/contract/agent.ts`), classified from the assistant message's `error`, a rejected `rate_limit_event`, the result's `api_error_status` and `terminal_reason`, and the last `api_retry`.
  The kinds are `usage-limit`, `rate-limit`, `overloaded`, `server-error`, `network`, `sign-in`, `billing`, `model`, `request` and `unknown`; the bridge protocol is version 42.
  Claude Code maps the HTTP errors of every endpoint (an API key, `ANTHROPIC_BASE_URL`, Bedrock, Vertex) into these kinds, so none needs code of its own; only a Claude plan reports `resetsAt`.
  The failure shapes come from tracer bullets through the fault proxy's new respond mode, recorded in `src/claude/fixtures/transcripts.json`.
  Claude Code's own API error message (`is_api_error_message`) is no longer shown as the agent's reply, since the paused or failed turn shows its text.
- **Main decides.**
  A pure policy in the chat domain turns a failure into a time to continue or a failure:
  a usage limit waits until `resetsAt` plus 5 seconds;
  a rate limit, an overloaded or failing API and a lost connection continue after 1, 2, 4, 8, 15 and 30 minutes of consecutive automatic attempts in one session, then fail;
  an unknown error continues once after a minute;
  sign-in, billing, model and request errors, and a failure with no kind, fail at once.
- **A pause is not a failure.**
  Before main stores a paused turn's `run.failed`, it adds `resumeAt`; the session goes idle, no **Turn finished** is logged, a job run whose turn pauses stays running, so a merge that waits on its fix job spends no attempt, and the alarm `resume:<sessionId>` fires **Time reached** with `wait: 'resume'` and the paused turn as its cause.
- **Resume continues it.**
  The Resume rule hears **Time reached** as well as **Malini started** (`RULE_EVENTS`), and continues a paused turn the way it continues one a quit cut short: the prompt again when Claude had not replied, else a prompt to go on, in the turn's chain, automated.
  It skips a turn that is no longer its session's latest, a session that was archived, and a job run that ended.
- **The chat shows it.**
  A paused turn reads **Paused until** a time, with its reason and **Resume now** (`chat.continue-run`) instead of **Run failed**.
  A failed turn that is its chat's latest gets **Try again** (the same command), and a sign-in failure **Sign in**.
  A prompt you send into a paused chat replaces the pause and clears its alarm.

## Consequences

- A limit or an outage no longer needs you: chats and jobs wait it out, and a merge waits for its fix job instead of giving up.
- A paused turn is neither failed nor cancelled; code that tells a failed turn apart reads `resumeAt`, the way it reads `PAUSED_FOR_EXIT_ERROR` for a quit.
- A pause lasts as long as the reset says, days for a weekly limit; **Resume now** and a new prompt are the ways out, and a job's pause ends when its run is cancelled.
- A turn that ends on a usage limit after some work goes on where it stopped, so its work is not redone, but a prompt sent again before Claude replied shows twice in the transcript, as for a quit.
- This extends 0085's Resume rule with a second event and 0091's `RULE_EVENTS`; the rest of both stands.
- Enforced by the bridge's `src/claude/run-failure.test.ts` (each recorded failure's kind), `session.test.ts` (every `run.failed` of a turn says what failed) and `transcript.test.ts` (the API error message is not echoed); in `apps/malini`, `src/lib/chat/domain/run-recovery.test.ts` (the policy), `src/lib/chat/platform/agent/runtime.test.ts` (back-off 1 to 30 minutes, then a failure), `commands.test.ts` (a pause, its alarm and Resume, a stale alarm, Try again), `protocol.test.ts`, `finished-turns.test.ts`, `src/lib/jobs/platform/register.test.ts` (a job keeps running through a pause and a restart), `src/lib/chat/domain/agent-attention.test.ts`, `src/lib/chat/presentation/chat-message-list/run-stop-copy.test.ts`, and `tests/e2e/run-recovery.spec.ts` (a usage limit pauses and goes on by itself, Resume now, Sign in and Try again).
