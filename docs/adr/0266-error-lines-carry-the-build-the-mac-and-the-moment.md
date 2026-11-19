# 0266 - Error lines carry the app, the device and the moment as JSON

Status: accepted

## Context

0263 made each error line name its kind, the line that threw and its repeats, but the field log still could not be acted on.
Two lines from Malini 0.125.0, `GPU process gone: crashed, exit 6` and `GPU process gone: abnormal-exit, exit 512`, said nothing about the Mac, how long Malini had run, whether it had just woken, or what the user did before.
Nothing told one Mac failing twenty times from twenty Macs failing once.
The `pnpm dogfood` window and `pnpm dev` report the package version `0.1.0`, so their sites point to no tagged source.
Logdash `/logs` keeps only the message, its level, namespace and time, up to 4096 characters, so context has to go in the text.
The user asked for context to fix errors with, and for nothing private or sensitive in it.
A first draft wrote the context as short text, `up 42m · wake 61s · uses 1.3 GB`, and the user found it hard to read.
Long flat keys that name owner and unit, such as `seconds_since_mac_woke`, still took effort to decode.
Sentry groups crash context by owner, `app`, `device` and `os`, with short keys inside, and the user picked that shape.
The user also did not want an error line to carry any account or install id, and did not want the time since the Mac woke.

## Decision

- An error line is a short headline, then one JSON object, written by `errorLine` in `src/lib/app/platform/usage-data.ts` for the Logdash sink and the tests alike:

  ```
  GPU process gone: crashed, SIGABRT {"app":{"version":"0.125.0 release a1b2c3d","running_for":"42m","memory_used":"1.3 GB","rendering":"gpu","screen":"workstreams","agent_runs":2},"device":{"chip":"Apple M3 Pro","memory":"18 GB","arch":"arm64"},"os":"macOS 27.0.1","last_commands":["chat.send-prompt","browser.show"],"stack":["lib/app/platform/register.ts:78"]}
  ```

- Keys are snake_case and grouped by owner, as Sentry's contexts are; values carry their unit as text, since Logdash only searches text.
- `app`:
  - `version` is the package version, the build and the commit: `release` for a packaged app, `dogfood` for the `pnpm dogfood` window, `dev` otherwise, then `git rev-parse --short=7 HEAD` at build time, defined as `import.meta.env.MAIN_VITE_COMMIT` in `electron.vite.config.ts` and left out outside git;
  - `running_for`, `memory_used`, `rendering`, `screen` and `agent_runs` come from `electronErrorMoment` in `src/lib/app/platform/error-context.ts`, read the moment the error happens: `process.uptime()`, the working set of every Malini process from `app.getAppMetrics()`, `gpu` or `software` from `app.getGPUFeatureStatus().gpu_compositing`, the first segment of the main window's hash route when it is a screen Malini has (`home`, `workstreams`, `repositories`, `automations`, `brain`, `dev`) or `other`, and the open runs from `listOpenRuns`.
- `device` holds `chip` from `os.cpus()`, `memory` from `os.totalmem()` and `arch` from `process.arch`; `os` is `macOS <version>`.
- `last_commands` holds the last six distinct command names started, newest first, from `commands.observeStarts`, so a command that polls takes one slot.
- `stack` holds up to five sites in Malini's source, thrower first, from `throwSites` in `src/main/diagnostics/throw-site.ts`, a site repeated in a row written once.
- A key whose value is `null` or an empty list is left out, and a moment read that throws drops the moment, never the line.
- The repeat line carries `app.version`, `device`, `os`, `stack` and `repeats_since_last_line`.
- A line never carries an account or install id, an error message, a command's arguments, a workstream, chat or run id, a path, a repository or branch name, or any part of a route past its first segment.

## Consequences

- A line now says which build and commit, which Mac, how long Malini ran, how much memory it used, which screen was open, what the user did and which calls led to the throw.
- A person or an agent reads each value by its group and name, and Logdash search finds a key and its value, such as `"rendering":"software"`.
- Errors from one Mac across launches cannot be told from errors on many Macs; within one launch, `repeats_since_last_line` still counts them.
- Dogfood and dev lines point at a commit, so their sites can be read.
- Lines grow by about 500 characters, below the 4096 Logdash keeps.
- Command names come from `$contract`, so `last_commands` can only hold names Malini defines.
- A new key must stay free of what the user typed or opened; only review of `electronErrorMoment` and `systemDetails` keeps it that way.
- `src/lib/app/platform/usage-data.test.ts` fails when a line loses its JSON, carries a command's arguments, an empty value or an id, or writes time and memory in another form.
- `src/main/diagnostics/throw-site.test.ts` fails when the sites lose their callers or repeat a site in a row.
