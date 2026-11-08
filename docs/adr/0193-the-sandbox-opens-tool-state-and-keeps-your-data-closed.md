# 0193 - The sandbox opens tool state and keeps your data closed

Status: accepted

## Context

0191 turns every blocked item into a card, and a workload that touches its own state folder brings one anyway.
On Nov 8, `pnpm --filter malini test:update` showed six items, and most were machinery: `~/Library/Application Support/rtk`, `~/.local/state/claude`, `~/Library/Logs/CoreSimulator`, the syslog socket and `/private/var/run`.
The user said "I would like Malini to just work", and when an inverted default offered to open every write except a protected set, "if I have some private documents on my machine, why would we enable access to all of them?"
0190 keeps the sandbox from naming a tool's folder, since the user answered "I don't want to solve my personal edge cases", so each tool's own state folder still costs a card.
Today the profile reads everything except credentials, so a malicious dependency can read the user's documents and send them out while the internet is on.
Each denial already names the process that caused it, and 0191 already widens a denied file to its folder.

## Decision

- `packages/agent-bridge/src/sandbox.ts` gains `USER_DATA`: `Documents`, `Desktop`, `Downloads`, `Pictures`, `Movies`, `Music`, `Library/Mail`, `Library/Messages`, `Library/Mobile Documents`, `Library/Photos`, `Library/Safari`, `Library/Calendars`, `Library/Reminders`, `Library/Application Support/AddressBook`, `Library/Containers` and `Library/Group Containers`.
  The profile denies `file-read*` and `file-write*` on them beside `CREDENTIALS` and `hidden`, and the grant refusal rejects them, so no card opens one.
- `toolStateGrant(denial, places, home)` accepts a `file-write` denial as a directory only when `grantProblem` accepts it and it lies under a tool-state root: `Library/Logs/<leaf>`, `.local/state/<leaf>`, `Library/Caches`, `.cache`, `.npm`, `Library/pnpm/store`, the temporary folders, or a dot-directory at the top of home.
  `Library/Application Support/<leaf>` is tool state only when `<leaf>` equals the denied process name, ignoring case, so `rtk` opens `rtk` and not `Slack`.
  A socket is never tool state.
- `ClaudeSession#record` adds an accepted tool-state grant to its grants at once, calls `#confine()`, and emits the `sandbox.granted` event with the process and the grant.
  No approval request is made, and the blocked context still tells the agent what failed, so its retry runs inside.
- Main stores each `sandbox.granted` as an `agent_permission_rules` row with `capability: 'sandbox'` and the `everywhere` scope, validates it again in `normalizeSandboxGrants`, and sends it with every `send_prompt` (protocol 51).
  Settings, Agent access lists each one and revokes it, and a revoked grant leaves the next profile.
- Everything outside those roots stays a card, as in 0191: `/private/var/run`, the syslog socket and `~/.docker/run/docker.sock` included, and every card keeps its chat, repository and everywhere scopes.
  A command that needs a user-data folder runs outside through 0172's card, and no remembered grant opens user data.

## Consequences

- Normal tooling stops asking: the six-item card from the update test becomes no card, or one for syslog or Docker, which stay manual.
- A malicious package can write any tool-state folder, and its own `Application Support` folder when it names its process after it, but it cannot read or write user data, credentials, persistence points or the checkout's hooks.
- A tool that reads a document now fails, and the outside card is the only way to open it for one run.
- A tool with state outside these roots still asks, and a new root is a line in the list, not a card for the user.
- Enforced by `sandbox.test.ts` (user data closed for read and write, tool state opens, `Application Support` matches the process, credentials and persistence stay closed), `session.test.ts` (the grant applies to the next command, no card, the event), `permissions.service.test.ts` (an `everywhere` sandbox rule, revocation), `commands.test.ts` (the grants go out with the next prompt) and `agent-interactions.spec.ts` (no card for tool state, Settings lists and revokes the grant), each on macOS, and a hostile-package test that reads a key, reads a document, writes a launch agent and a shell rc file, and fails all four.
