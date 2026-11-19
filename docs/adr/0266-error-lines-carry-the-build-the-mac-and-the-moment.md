# 0266 - Error lines carry the build, the Mac and the moment

Status: accepted

## Context

0263 made each error line name its kind, the line that threw and its repeats, but the field log still could not be acted on.
Two lines from Malini 0.125.0, `GPU process gone: crashed, exit 6` and `GPU process gone: abnormal-exit, exit 512`, said nothing about the Mac, how long Malini had run, whether it had just woken, or what the user did before.
Nothing told one Mac failing twenty times from twenty Macs failing once.
The `pnpm dogfood` window and `pnpm dev` report the package version `0.1.0`, so their sites point to no tagged source.
Logdash `/logs` keeps only the message, its level, namespace and time, up to 4096 characters, so context has to go in the text.
The user asked for context to fix errors with, and for nothing private or sensitive in it.

## Decision

- An error line reads `<what> · malini <version> <build> · macOS <version> <arch> · <context> · id <id>`, built in `startUsageData` in `src/lib/app/platform/usage-data.ts`.
- `<build>` is the channel, `release` for a packaged app, `dogfood` for the `pnpm dogfood` window and `dev` otherwise, then the commit.
  The commit is `git rev-parse --short=7 HEAD` at build time, defined as `import.meta.env.MAIN_VITE_COMMIT` in `electron.vite.config.ts`, and left out when the build runs outside git.
- `<context>` comes from `errorContextLine` in `src/lib/app/platform/error-context.ts`, read the moment the error happens:
  - the chip from `os.cpus()` and the memory from `os.totalmem()`, in whole GB;
  - `gpu hardware` or `gpu software`, from `app.getGPUFeatureStatus().gpu_compositing`;
  - `up`, the time since launch, and `wake`, the time since the last `powerMonitor` resume, left out before the first wake;
  - `uses`, the working set of every Malini process from `app.getAppMetrics()`, and `runs`, the open runs from `listOpenRuns`;
  - `on`, the first segment of the main window's hash route when it is a screen Malini has (`home`, `workstreams`, `repositories`, `automations`, `brain`, `dev`), or `other`;
  - `after`, the last six distinct command names started, newest first, from `commands.observeStarts`, so a command that polls takes one slot.
- A command failure names up to five sites in Malini's source, thrower first and joined with `<`, from `throwSites` in `src/main/diagnostics/throw-site.ts`, a site repeated in a row written once.
- `<id>` is the first eight hex characters of `sha256(<site>:<user>)`, the hash the usage counts of the same account or install already carry (0243).
- A context read that throws drops the context, never the line.
- The `<n> more` repeat line keeps the short form, `<what> · <n> more · <system>`.
- A line still never carries an error message, a command's arguments, a workstream, chat or run id, a path, a repository or branch name, or any part of a route past its first segment.

## Consequences

- A line now says which build and commit, which Mac, how long Malini ran and since when it woke, how much memory it used, which screen was open, what the user did and which calls led to the throw.
- One install's errors group by id, and join its usage counts, without a new identifier: the counts already carry the full hash.
- Dogfood and dev lines point at a commit, so their sites can be read.
- Lines grow by about 300 characters, far below the 4096 Logdash keeps.
- Command names come from `$contract`, so the trail can only hold names Malini defines.
- A new context field must stay free of what the user typed or opened; only review of `errorContextLine` keeps it that way.
- `src/lib/app/platform/usage-data.test.ts` fails when a line loses its context, carries a command's arguments, or ends with an id other than the start of the counts' hash.
- `src/main/diagnostics/throw-site.test.ts` fails when the sites lose their callers or repeat a site in a row.
