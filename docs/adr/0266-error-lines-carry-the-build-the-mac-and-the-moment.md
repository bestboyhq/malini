# 0266 - Error lines carry the build, the Mac and the moment as JSON

Status: accepted

## Context

0263 made each error line name its kind, the line that threw and its repeats, but the field log still could not be acted on.
Two lines from Malini 0.125.0, `GPU process gone: crashed, exit 6` and `GPU process gone: abnormal-exit, exit 512`, said nothing about the Mac, how long Malini had run, whether it had just woken, or what the user did before.
Nothing told one Mac failing twenty times from twenty Macs failing once.
The `pnpm dogfood` window and `pnpm dev` report the package version `0.1.0`, so their sites point to no tagged source.
Logdash `/logs` keeps only the message, its level, namespace and time, up to 4096 characters, so context has to go in the text.
The user asked for context to fix errors with, and for nothing private or sensitive in it.
A first draft wrote the context as short text, `up 42m · wake 61s · uses 1.3 GB`, and the user found it hard to read and asked for JSON with snake_case names no one can misread.

## Decision

- An error line is a short headline, then one JSON object: `<what> {"stack":[…],"last_commands":[…],…,"reporter_id":"…"}`.
  `errorLine` in `src/lib/app/platform/usage-data.ts` writes it, for the Logdash sink and the tests alike.
- Every key is snake_case and names whose value it is and its unit, such as `seconds_since_malini_started` and `seconds_since_mac_woke`, never a bare `uptime` or `wake`.
- The keys come in this order, and a key whose value is `null` or an empty list is left out:
  - what happened: `stack`, up to five sites in Malini's source, thrower first, from `throwSites` in `src/main/diagnostics/throw-site.ts`, a site repeated in a row written once; and `last_commands`, the last six distinct command names started, newest first, from `commands.observeStarts`, so a command that polls takes one slot;
  - the moment, from `electronErrorMoment` in `src/lib/app/platform/error-context.ts`: `open_screen`, the first segment of the main window's hash route when it is a screen Malini has (`home`, `workstreams`, `repositories`, `automations`, `brain`, `dev`), or `other`; `open_agent_runs`, from `listOpenRuns`; `malini_rendering`, `gpu` or `software`, from `app.getGPUFeatureStatus().gpu_compositing`; `malini_memory_used_mb`, the working set of every Malini process from `app.getAppMetrics()`; `seconds_since_malini_started`; and `seconds_since_mac_woke`, from the last `powerMonitor` resume, left out before the first wake;
  - the build: `malini_version`, `malini_build` (`release` for a packaged app, `dogfood` for the `pnpm dogfood` window, `dev` otherwise), `malini_commit`, `malini_arch`;
    the commit is `git rev-parse --short=7 HEAD` at build time, defined as `import.meta.env.MAIN_VITE_COMMIT` in `electron.vite.config.ts`, and left out when the build runs outside git;
  - the Mac: `macos_version`, `mac_chip` from `os.cpus()` and `mac_memory_gb` from `os.totalmem()`;
  - `reporter_id`, the first eight hex characters of `sha256(<site>:<user>)`, the hash the usage counts of the same account or install already carry (0243).
- A context read that throws drops the moment, never the line.
- The repeat line carries `stack`, `repeats_since_last_line` and the build and the Mac, with no moment.
- A line still never carries an error message, a command's arguments, a workstream, chat or run id, a path, a repository or branch name, or any part of a route past its first segment.

## Consequences

- A line now says which build and commit, which Mac, how long Malini ran and since when it woke, how much memory it used, which screen was open, what the user did and which calls led to the throw.
- A person, an agent or `jq` reads each value by its name, and Logdash search finds a key and its value, such as `"malini_rendering":"software"`.
- One install's errors group by `reporter_id`, and join its usage counts, without a new identifier: the counts already carry the full hash.
- Dogfood and dev lines point at a commit, so their sites can be read.
- Lines grow by about 500 characters, below the 4096 Logdash keeps.
- Command names come from `$contract`, so `last_commands` can only hold names Malini defines.
- A new key must stay free of what the user typed or opened; only review of `electronErrorMoment` and `systemDetails` keeps it that way.
- `src/lib/app/platform/usage-data.test.ts` fails when a line loses its JSON, carries a command's arguments or an empty value, or ends with a `reporter_id` other than the start of the counts' hash.
- `src/main/diagnostics/throw-site.test.ts` fails when the sites lose their callers or repeat a site in a row.
