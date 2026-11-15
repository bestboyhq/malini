# 0248 - The run script shortens command output with a bundled RTK

Status: accepted

## Context

Command output is most of what an agent reads, and RTK (`rtk-ai/rtk`) has a filter for each common command that keeps errors and drops noise.
RTK's own way in is a PreToolUse hook that rewrites `git status` to `rtk git status` in `updatedInput`, which 0141 refuses: permission rules, auto mode and approval cards would check the rewritten text, and auto mode refuses the call once (0249).
Malini already runs every Bash command through its own `run` script once permissions are decided (0141), inside its own sandbox (0167), so a rewrite there leaves the command as written everywhere else.
The default `rtk` build links `rtk-engine` under BUSL-1.1, whose grant does not cover use inside another product, and `rtk-proxy` is BUSL-1.1 too; `rtk-oss` is Apache-2.0 and holds every command filter.
Malini already ships a pinned `gh` beside the app (0014), and the same pattern carries a pinned `rtk`.

## Decision

- **Packaging.** `apps/malini/scripts/fetch-rtk.mjs` pins `RTK_VERSION` 1.2.0 and a table `RTK_BUILDS` of the `rtk-oss` asset and sha256 for macOS arm64 and x64, Linux x64 and arm64 (musl) and Windows x64, from the release's `checksums.txt`.
  It downloads the build for the machine, refuses it unless the sha256 matches, and writes `apps/malini/vendor/rtk/{bin/rtk,LICENSE,VERSION}`, which git ignores, skipping the download when `VERSION` already matches.
  `pnpm dist`, `release` and `test:update` run it after `fetch-gh.mjs`, `pnpm dogfood` runs it after `pnpm install`, and the CI checks job runs it before the package tests.
  `extraResources` ships the folder as `Resources/vendor/rtk`, `NOTICE` and the About panel name RTK (Apache-2.0), and Malini never ships the default `rtk` build or `rtk-proxy`.
- **No outbound call.** Nothing downloads RTK at run time, and telemetry stays off, so the app's own outbound calls stay at twelve in `AGENTS.md`.
- **The path.** The main process starts the bridge with `MALINI_RTK_BINARY` set to `<resourcesRoot>/vendor/rtk/bin/rtk`, and `SessionSecrets` takes it; `claudeEnvironment` still drops every `MALINI_*` variable from Claude Code.
  Each `sendPrompt` writes `compact.sh` beside `run`, with `rtk=<path>` and the RTK variables, while `compactOutput` is on, and removes it while it is off.
  A warm run whose `compactOutput` differs is not continued, so its system prompt and its commands agree.
- **Which commands.** Claude Code 2.1.325 hands the prefix a Bash call, a subagent's included, as one string: `<snapshot and shell options> && eval '<command>' < /dev/null && pwd -P >| <cwd file>`, with each `'` in the command written `'"'"'`.
  Command hooks and stdio MCP servers reach the same prefix as the bare command.
  `run` rewrites only the `eval` body of that shape, so a hook, an MCP server or a shape it does not know runs unchanged.
- **The rewrite.** `run` asks `rtk rewrite "<command>"` under the same `sandbox-exec` profile as the command, or none on a pass outside, and waits at most two seconds.
  It takes the answer only when rtk exits 0 or 3 and removing every `rtk ` from it gives back the command, so `cat` never becomes `rtk read` and `pnpm lint` never becomes `rtk lint`.
  Exit 1, exit 2 for a deny rule, any other exit, an empty answer, no answer in time, a missing binary or a command that already holds `rtk` run the command as written.
- **The binary wins.** `run` puts the bundled folder first on `PATH` inside the wrapper, after the snapshot that exports the user's `PATH`, so the rewrite and the agent's own follow-ups such as `rtk git diff --no-compact` run the bundled build, never a `rtk` the user installed.
- **Its own data.** `compact.sh` sets `RTK_TELEMETRY_DISABLED=1` and points `RTK_DB_PATH`, `RTK_RECALL_DB` and `RTK_TEE_DIR` at `$TMPDIR/malini-rtk`, which the sandbox writes and the agent reads; nothing goes to the user's `~/Library/Application Support/rtk`.
- **The user's RTK config.** rtk reads `~/Library/Application Support/rtk/config.toml` and its user filters, and only `HOME` moves them, which would also move git's and gh's config, so Malini leaves it: a user's own RTK config also shapes Malini's output.
  A project's `.rtk/filters.toml` stays untrusted, since `RTK_TRUST_PROJECT_FILTERS` is not set.
- **The agent.** While `compactOutput` is on, the instructions add one line: common commands print shortened, a cut output names the command that prints the rest, and `RTK_DISABLED=1 <command>` prints in full.
- **Scope.** Only `ClaudeSession` sets `CLAUDE_CODE_SHELL_PREFIX`, so chats and agent automations get it, and the **Run** button, workstream installs and probe queries do not.

## Consequences

- Sixteen common read-only commands replayed through `run` in this repository, switch off and on, printed 151,262 and 58,783 characters, 61% fewer; `git diff` alone went from 116,113 to 32,006, and the other fifteen from 35,149 to 26,777, 24% fewer.
- Of the 7,510 distinct Bash commands in the last forty Malini chats, `rtk rewrite` gives 1,266 a prefix-only rewrite (17%) and the prefix rule turns down 416 more.
- The command the agent wrote stays what the chat shows and what rules, auto mode and approval cards check.
- A hung `rtk rewrite` costs its command two seconds and lingers until it exits, which the `ponytail:` line in `secrets.ts` names.
- A Claude Code that changes its Bash wrapper gets no rewrite until `run` learns the new shape; commands then run in full, never fail.
- Moving to a newer RTK changes `RTK_VERSION` and every row of `RTK_BUILDS` together.
- Enforced by the bridge's `secrets.test.ts` (rtk exits 0 and 3 taken, 1, 2 and 5 refused, the two-second limit, the prefix rule, a bare hook command, the switch off, a missing binary, masks and exit codes through a rewrite, the bundled rtk shortening `git status` and keeping `git log`'s 128, and the same in the sandbox with a pass outside), `instructions.test.ts` (the line only while on), `apps/malini/scripts/fetch-rtk.test.mjs` (the pinned build in place once, a wrong sha256 refused) and `dogfood.test.mjs`; CI fetches the binary so the bundled cases run there.
