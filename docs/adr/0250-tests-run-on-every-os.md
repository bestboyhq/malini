# 0250 - Tests run on every OS

Status: accepted

## Context

Malini ships for macOS, Windows and Linux on x64 and arm64 (0252), but CI ran unit tests on Linux x64 and e2e on macOS only.
The first CI run of the port on Windows failed in every unit shard and never started e2e: the tests assumed `/` paths, `/bin/sh` stubs, LF checkouts, `HOME` as the home folder and `chmod` to lock a folder.
On Windows a test that set only `HOME` wrote into the runner's real profile, and Git for Windows' system `core.autocrlf=true` turned fixtures into CRLF.
On Linux the e2e had no display and no keyring, so every secret and Claude account test failed.
The ChatGPT sign-in failed there too, because its fake listened on `localhost`, which resolves to `::1` first on Linux.
A packaged build can break where no test runs, as the main process loading node-pty from the asar (0251).

## Decision

- **Unit tests on five machines.**
  The `unit` job in `.github/workflows/ci.yml` runs on Linux x64 and arm64, macOS, and Windows x64 and arm64, each in three shards of the app's tests and one part for the packages.
- **E2e on three.**
  The `app` job runs the Playwright suite on macOS, Ubuntu 24.04 and Windows, five shards each on a pull request and three on `main`.
- **Linux as a desktop has it.**
  The `linux-display` step starts Xvfb on `:99` and lets Electron's sandbox use user namespaces, which Ubuntu 24.04 restricts by default.
  The shard runs through `apps/malini/tests/linux/keyring.sh`, which starts a D-Bus session and a gnome-keyring unlocked with a password in a private folder, so `safeStorage` encrypts as on a desktop.
- **Windows as a user has it.**
  The `windows-long-paths` step sets `core.longpaths`, `.gitattributes` keeps the checkout LF, and the unit tests run with `GIT_CONFIG_NOSYSTEM=1` and with `TEMP` and `TMP` beside `TMPDIR`, at their real path.
  Git Bash turns on the backup and restore privileges of an admin, as every Cygwin program does, and Node opens files with backup semantics, so on the runner a deny rule stopped git but never Node.
  The unit and e2e steps therefore run through `apps/malini/tests/windows/desktop-user.sh`, which removes both privileges from its token before the tests start, and fails when they are still there.
- **Every package builds and opens on a pull request.**
  The `package` job builds the unsigned app on macOS and the real installers on Windows and Linux, then `scripts/packaged-smoke.mjs` opens the build to Repositories and starts a terminal from the packaged node-pty.
  The Windows and Linux installers stay as a seven-day artifact, for a person to try on a real machine.
- **The same Linux on a Mac.**
  `sh apps/malini/tests/linux/run.sh unit|e2e|flow|exec [args]` runs the tracked tree on Ubuntu 24.04 in Docker, under Xvfb and the same keyring, and writes results to `$MALINI_LINUX_OUT`; on Apple silicon it runs arm64.
- **Tests write what each OS needs.**
  `writeExecutable` in `tests/e2e/harness.ts` writes a stub and, on Windows, a `.exe` beside it, built from `tests/e2e/stub-launcher.cs`, that runs the stub with Node or Git Bash.
  The launcher hands each argument to Git Bash in an environment variable, since Git Bash parses its own command line and drops the braces of `HEAD^{tree}`.
  `REAL_GIT` resolves git through `findExecutable`, and `lockFolder` uses `chmod` on POSIX and an `icacls` deny rule on Windows, with `DENIED` naming the error code each OS reports.
  A test that fakes the home folder sets `USERPROFILE` with `HOME`, and fakes listen on `127.0.0.1`.
  A test for one OS only is `it.runIf`, such as Run's PowerShell and Command Prompt cases.

## Consequences

- A change that assumes one OS fails on its pull request, before it reaches a user on another.
- A pull request takes more runners: 20 unit jobs, 15 e2e shards and 3 package jobs.
- Windows e2e runs the fake bridge, as every OS does, so Claude Code's own Windows behavior is proved only in the real app.
- The packaged smoke proves a boot and a terminal, not signing, which only the `release` job and a real machine prove.
- Enforced by the `unit`, `app` and `package` jobs in `.github/workflows/ci.yml`, whose failure blocks a merge.
