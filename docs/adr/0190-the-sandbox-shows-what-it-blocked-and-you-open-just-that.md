# 0190 - The sandbox shows what it blocked, and you open just that

Status: accepted

## Context

0167 and 0172 gave a command that needs what the sandbox blocks one way out: run it outside, where it reads and changes anything on the Mac.
After 0189, Docker, agent-browser's `~/.agent-browser` and wrangler's logs still sent commands out, and each fix by name only covered the user's own tools; the user asked for "a system that will support various cases".
The kernel already reports every denial: a deny-default rule `(with message "<tag>")` adds the tag to the report, and `log stream` shows it to a process outside the sandbox.
The user picked the variant that opens the blocked item inside the sandbox, and asked for **Allow once** in place of "Run once outside".
A Claude Code process stays warm across turns, so a grant must reach a running session, and Malini's database already keeps remembered approvals by scope.

## Decision

- Each `ClaudeSession` tags its profile `malini-sandbox-<16 hex>`, and `SandboxDenials` in `packages/agent-bridge/src/sandbox-denials.ts` runs one `/usr/bin/log stream` on the kernel's Sandbox reports, `processID == 0`, and routes each denial by its tag.
  It runs only while a sandboxed `Bash` call runs and for a minute after, a call waits for its first line, about 30 ms, and the shell around it ends it once the bridge's pipe closes, even after a `SIGKILL`.
- `sandboxGrant` turns a denial into a grant: the socket a command could not reach, or the folder it could not write, widened up to the child of a shared folder such as `~/Library/Application Support/<app>` or `~/.<tool>`.
  `grantProblem` refuses what is not absolute and normalized, Malini's secrets and own data (`MALINI_APP_DATA_ROOT`), a key agent's socket, a shared folder, the checkout or a folder holding it, credentials and what runs outside the sandbox later.
- After each `Bash` call, the session hands Claude what the sandbox blocked during it as `additionalContext`, so the agent knows why it failed.
- A request to leave the sandbox with grantable denials from the last 10 minutes becomes a `sandbox` permission: the card names each blocked item with what opening it lets a command do, and offers **Deny**, **Always allow** for this chat, this repository or everywhere, and **Allow once**.
  **Allow once** runs that command inside a one-time profile, a `: malini-inside-<32 hex>;` pass whose `.sb` the run script reads and deletes.
  **Always allow** adds the grants to the live `sandbox.sb`, written atomically, and the command runs inside.
  With nothing grantable, the card stays 0172's exit card.
- The session keeps, for its last 200 commands, what the user was asked to open for each, so the same command asking again after **Allow once** gets the same card, even past 10 minutes.
- A request to leave for a command the session has not seen run inside, with nothing to offer, goes back to the agent once, without a card, as `RUN_IT_INSIDE_FIRST`.
  In the first native run, the agent asked to leave for `docker ps` again right after **Allow once**, and after **Always allow** an agent that left before would ask to leave for a command that now runs inside.
- A granted folder is writable, its sockets reachable, and its git hooks, git config, `.claude/settings.json` and `.mcp.json` stay denied.
- Main keeps the grants as `agent_permission_rules` with `capability: 'sandbox'`, a new `repository` scope on `project_id`, validates them again in `normalizeSandboxGrants`, and sends the ones for the chat as `sandboxGrants` with every `send_prompt` (protocol 49), which replaces the session's list; Settings, Agent access lists and revokes them.
- `TOOL_HOMES` and `AGENT_BROWSER_ARGS` from 0189's first draft are gone.

## Consequences

- One card per blocked item, once per chat, repository or Mac, replaces a command running outside for every tool the user installs.
- A command can read and change everything in a folder the user opened, and a container can read every folder Docker shares once Docker's socket is open; the card says so.
- The stream costs about 4% of one core while it runs, measured on Nov 8; without the `processID` filter it cost about 12%, and `log show` cannot replace it, since the store keeps no Sandbox reports.
- `log stream` may need admin rights on a managed Mac; without it, Malini sees nothing, and every exit card is 0172's.
- A denial reaches a card only when the agent then asks to leave the sandbox, and the session forgets it after 10 minutes or past 50.
- An agent that asks to leave before it tries a command pays one run inside first, and after a restart the session has seen nothing, so each command tries inside again.
- Enforced by `sandbox.test.ts` (a granted folder and socket open, its hooks stay closed, a denial arrives under its tag, refused grants) on macOS, `secrets.test.ts` (an inside pass works once and cannot be forged), `session.test.ts` (Allow once, Always allow, the same card again, a first exit sent back and the blocked context), `permissions.service.test.ts` (grant validation, repository rules), `commands.test.ts` (grants go out with the next prompt) and `agent-interactions.spec.ts` (the card, its scopes and Settings).
