# 0136 - A secret is a name the agent asks for in the chat, and every command gets

Status: accepted

## Context

Agents asked for a secret with `files_open` (0064, 0079): the user switched to a file tab beside the chat, typed the value after a `KEY=` line, and switched back, and commands read that file only through the user's own `secrets-run`.
`files_open` also took worktree paths such as `apps/x/.env`, and archiving keeps only `.context` and the attachments (`KEPT_FOLDERS` in `kept-folders.ts`), so a pasted secret "is gone after the work stream got archived".
The user wants it "inlined in a chat so I don't need to go anywhere", and "the user shouldn't give a fuck where the secrets sit ... file system paths, nobody gives a fuck about it".
0135 makes where a secret lives an adapter's job, with this Mac's keychain first.
Two simpler injectors fail in Claude Code 2.1.293.
A PreToolUse hook that wraps each Bash command changes `updatedInput`, which is what permission rules, auto mode and the approval card check next, so `Bash(npm test:*)` would stop matching and every card would show the wrapper.
Masking in a PostToolUse hook misses every command that exits non-zero: Claude Code reports those through PostToolUseFailure, which cannot rewrite output.

## Decision

- A secret is a name, a value and a scope: one repository, by its `owner/name`, or everywhere, and a repository's value wins over an everywhere one of the same name.
  A name matches `^[A-Za-z_][A-Za-z0-9_]*$`; names that steer a shell or Malini itself, such as `PATH`, `HOME`, `IFS`, `DYLD_*`, `LD_*`, `CLAUDE_*` and `MALINI_*`, are refused.
- **Keychain adapter.** `src/lib/secrets/platform/keychain.ts` seals each value with Electron's `safeStorage`, whose key lives in the macOS keychain item `malini Safe Storage`, and keeps it in `secrets` (migration 85).
  No command returns a value: the renderer sends values in and gets back names, scopes and when each was saved.
- **Asking.** Bridge protocol 44 adds the pre-approved platform tool `secrets_request`, with one to ten `names` and a `why`.
  It returns at once, like `decisions_ask` (0112): Malini keeps the request in `secret_requests`, emits `secrets:requested`, and shows a card over the composer of that chat with a password field for each name, **Save** and **Dismiss**.
  A second request in the same chat takes over an open one and keeps its names.
- The card offers no scope: where a secret sits is Malini's call, not the user's.
  A request is saved for its chat's repository, or for everywhere from a chat at Home or in an organization, so `secrets.save` with a `requestId` takes no `repository`.
- Pasting `NAME=value` lines anywhere in the chat outside a dialog fills every field they name, and a bare value fills the first empty field while no input has the focus, so a secret pasted out of habit lands on the card instead of in the composer.
- **Saving** seals every filled name under the request's scope and emits `secrets:saved` with the names, never the values.
  The chat platform sets the values in every running session they reach, and the Deliveries rule hears the event and delivers "Saved NAME ..." to the chat that asked (0109), which wakes it when it waits.
- **Using.** `send_prompt` carries the secrets that reach its session, and `set_secrets` replaces them in a running one.
  The bridge keeps them in a `0600` file in a `0700` folder under the system's temporary folder, and starts Claude Code with `CLAUDE_CODE_SHELL_PREFIX` set to that folder's `run` script and `CLAUDE_CODE_SHELL` to the shell Claude Code would pick anyway.
  Claude Code runs every Bash command and command hook through `run` once permissions are decided: it exports the values, runs the command in that shell, masks its output and exits with the command's status.
  The command the agent wrote is the one that permissions, auto mode and approval cards see.
- **Masking.** `run` replaces every value of eight or more characters, and each such line of a multi-line value, with `[secret]` in stdout and stderr, through one filter when both go to the same file so their order holds; failing and background commands are masked like the rest.
  A PostToolUse hook does the same to every other tool's output through `updatedToolOutput`, such as a Read of a file that holds a value.
  So neither the model, Malini's transcript, nor Claude Code's session log and task files hold a value.
- **Managing.** Settings, Secrets lists the names by scope with when each was saved, and **Replace** or **Delete** for each; values never show.
- The agent instructions say `$NAME` is set for every saved secret, to ask with `secrets_request` and name what waits in `Needs:`, and never to ask for a value in the chat or write one to a file.
- `files_open` loses `keys`, which supersedes 0079.
  It stays for other files only the user should write, and the rest of 0064 stands.

## Consequences

- The user pastes a secret once, where the agent asks, and it reaches every workstream of that repository, survives archiving and restarts, and never shows again.
- Permission rules and auto mode match commands as written, since the values ride in Claude Code's own shell prefix.
- A user's own `CLAUDE_CODE_SHELL_PREFIX` is replaced for Malini's sessions, and a command's output gains a final newline when it lacked one.
- A decrypted copy sits on disk while a session runs, readable only by the user and outside Time Machine.
  The bridge removes it when a session closes and when Malini stops it with SIGTERM, which the bridge turns into a normal exit for that reason, and the next bridge removes the folder of one that was killed.
- Masking catches a value as written, not an encoded one, like `secrets-run`: an agent that sets out to leak a secret can, so the defenses stay the approvals and the sandbox's network allowlist.
  A value shorter than eight characters is set but not masked.
- A tool that reads only a file, never its environment, does not get the secrets; projects that load `.env` with dotenv do, since dotenv never overrides a variable that is already set.
- Sharing a secret with teammates is left to a future adapter, such as Cryptly.
- Enforced by `src/lib/secrets/platform/register.test.ts` (sealing, scopes, refused names, requests taken over, no command returning a value), `src/main/db/migrations.test.ts` (migration 85), the bridge's `secrets.test.ts` (the `run` script exporting, masking by length and by line, keeping exit codes and stream order, the folder removed on SIGTERM and that of a dead bridge removed), `session.test.ts` (the shell prefix and the PostToolUse hook), `protocol.test.ts` and `browser-tools.test.ts`, and `tests/e2e/secrets.spec.ts`, where an agent asks for a key, the user saves it on the card, the agent hears it, the value reaches the bridge but never the transcript nor any file in Malini's data folder, and Settings replaces and deletes it.
