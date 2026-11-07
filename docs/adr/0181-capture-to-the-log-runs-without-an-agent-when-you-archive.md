# 0181 - Capture to the log runs without an agent when you archive

Status: accepted

## Context

The brain (0180) needs what you typed in a chat once you are done with it.
`repositories:workstream-removed` fires once for both an archive and a delete, with `archived` or `deleted` set, and the user wanted capture to "run on archive", never on a delete.
An agent that read chats to capture them would see every chat and reach Anthropic with all of them, which is what 0167's boundary keeps an automation from by default, and a model could paraphrase, drop or invent a line in a log meant to be raw.
Copying what you typed needs no model: **Open draft** and **Merge** already run as Malini code under an automation's name.
Home chats are never archived, so an archive alone would never capture them.

## Decision

- **No agent.**
  **Capture to the log** (`capture-brain`) is an `AgentlessAutomationBuiltin`, and `#runAgentless` in `automation-runner.service.ts` hands it to `brain.capture` (`src/lib/brain/platform/brain-capture.service.ts`), which succeeds with "Nothing new" or "2 chats, 5 turns".
  Its trigger is `on repositories:workstream-removed where archived is set`, so a delete starts nothing, and a deleted workstream's chats are gone before the event anyway.
- **Once a day for the rest.**
  At launch and every hour, while the brain exists and the automation is not Off, Malini starts it once per local day through `automations.run` with origin `schedule` and records the day as `brain.caught-up-on`, for Home and organization chats that are never archived.
- **One sweep, once.**
  Each run takes every chat you started (`agent_sessions.origin = 'user'`) in an archived workstream or a Home or organization chat, outside the brain, from the first event after `brain_captures.last_seq` for that chat and `brain.since-seq`.
  It keeps what you typed and each turn's `Outcome:` line only: never what the agent wrote, tool results or code, prompts other chats sent, automation runs, or turns you undid.
  A chat stops at its first unfinished turn, so that turn lands with its outcome on the next capture.
  It appends one section per chat, `## <chat name> - <repository, organization or Home>`, then each turn's prompts quoted under its `Outcome:`, to `log/<today>.md`, starting the file with `# <today>`, and then saves the cursor.
  A capture with nothing new writes and commits nothing.
- **Secrets out first.**
  `redactBrainText` in `capture-log.ts` masks every value you saved in Settings, Secrets (0141) as `[secret]`, the longest first, skipping values shorter than four characters, which would mask ordinary words, then runs `redactSensitiveText`, which drops token shapes, passwords in URLs, emails and your home folder as diagnostics do.
  Chat names go through the same.
- Malini then commits and pushes the log (0182).

## Consequences

- A log line is exactly what you typed, minus secrets, and capturing costs no model call and sends no chat to Anthropic.
- A secret saved under four characters, or one you never saved that has no token shape, stays in the log; the repository is private and only yours, and you can edit a log file by hand.
- The log grows only from the brain's set-up on, and a chat captured once is never captured twice, even when you restore and archive it again.
- Enforced by `src/lib/brain/platform/capture-log.test.ts` (secrets masked longest first, short values left, token shapes, home paths and emails dropped, turns grouped under their outcome, a chat stopped at an unfinished turn), `src/lib/brain/platform/brain-capture.service.test.ts` (on real SQLite: archived and Home chats with their outcomes and never the assistant, nothing on a second capture, nothing of a deleted workstream, skipping the brain, automations, sent prompts and turns from before the brain) and `tests/e2e/brain.spec.ts` (an archived chat lands redacted, a deleted one never does, a second capture adds nothing).
