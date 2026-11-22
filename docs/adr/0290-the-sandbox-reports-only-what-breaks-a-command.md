# 0290 - The sandbox reports only what breaks a command

Status: accepted

## Context

0191 made the bridge report every tagged denial after a command, and 0193 opened tool state by folder without a card.
The user called the sandbox tedious and said they sometimes switch a chat to full access so Malini stops asking.
A read of 1,678 chat transcripts found why:

- About three quarters of the report lines were Electron and Chrome looking up services they do without, and `node: network-outbound` with no address, after commands that succeeded.
  Agents read them as a failure, left the sandbox and showed a card.
- 335 cards in 155 chats, none denied, and 17 chats on full access.
- 61 grants of `~/.claude.json.lock` and `~/.claude.json.tmp.*`, which open nothing useful, since `~/.claude.json` stays closed.
- 295 `zsh: system-sched self` and 177 `ffmpeg: system-sched self` blocks: zsh lowers the priority of a `&` job and ffmpeg of its threads, and `taskpolicy -b` exits 70.
- ffmpeg, `say` and Metal shaders blocked on media, voice and compiler services.
- 39 chats hit `sandbox_apply: Operation not permitted` from `swift build` and `swift test`, which start their own sandbox.
- The explicit deny rules carried no message tag, so a refused git hook write never showed in the report.
- A granted dot folder such as `~/.cargo` opened `~/.cargo/bin`, whose programs run outside the sandbox later.

## Decision

- `isHarmlessDenial` in `packages/agent-bridge/src/sandbox.ts` marks a `network-outbound` with no target, and anything but a file read or write by a process named Chrome, Chromium or Electron.
  `sandboxBlockedContext` in `src/claude/permissions.ts` leaves those out, says nothing when nothing is left, and keeps the Chrome hint whenever a Chrome was blocked.
- The profile allows `system-sched`, the sysctls `kern.grade_cputype` and `vfs.nspace.prevent_materialization` next to `kern.tcsm_enable`, and the services `com.apple.accessibility.voices`, `com.apple.audio.AudioComponentRegistrar`, `com.apple.audio.ComponentTagHelper`, `com.apple.audio.SandboxHelper`, `com.apple.coremedia.videodecoder`, `com.apple.coremedia.videoencoder` and `com.apple.MTLCompilerService`.
- `RUN_OUTSIDE_LATER` adds `~/.codex`, `~/.cursor`, `~/.cargo/bin`, `~/.cargo/config`, `~/.cargo/config.toml` and `~/.local/bin`, and `PROGRAMS_ON_THE_PATH` adds `/opt/homebrew/bin` and `/usr/local/bin`.
  The profile denies writes to all of them after its allows, so a grant of a parent folder never opens them, and no card or tool-state grant offers them.
- A grant of a sibling file of one of those places, such as `~/.claude.json.lock`, is refused like the place itself.
- Every explicit deny carries the session's message tag, so its blocks reach the report and the card.
- The agent instructions tell Claude to pass `--disable-sandbox` to `swift build`, `swift test`, `swift run` and `swift package`.
- Location, the pasteboard, the keychain beyond `gh`, Apple events, the camera, `audiohald`, CoreSimulator, Malini's own data and the folders that hold logins, such as `~/Library/Preferences/.wrangler`, stay closed.

## Consequences

- A command that succeeds no longer sends the agent out of the sandbox because of browser engine noise, so fewer cards ask the user anything.
- A program planted in a folder on the PATH, a Cargo config or a Codex or Cursor config cannot run outside later, even in a folder the user opened.
- `brew install` and `cargo install` now need a run outside, and the card asks for it.
- A block by Chrome, Chromium or Electron on a service it truly needs no longer shows; the Chrome hint and the browser tools cover it.
- `sandbox.test.ts` fails when a granted `~/.cargo` lets a command write `~/.cargo/bin`, when `taskpolicy -b` cannot run, when a refused git hook write misses the report, when a card offers one of the new places or a sibling of `~/.claude.json`, or when `isHarmlessDenial` changes what it hides.
- `permissions.test.ts` fails when the report shows only harmless blocks, hides a real one, or drops the Chrome hint; `instructions.test.ts` fails when the SwiftPM line goes.
