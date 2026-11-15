# 0252 - Malini runs on Windows, Linux and Intel Macs

Status: accepted

## Context

Malini shipped one build, for Apple silicon: a dmg, a zip and `latest-mac.yml`, with a `gh` for macOS arm64, macOS words and keys in the renderer, and Squirrel.Mac updates.
In 90 days bestboy.dev/malini had 170 macOS desktop visitors, 29 on Windows and 11 on Linux, while the page offered only the Mac download.
The user: "We have to support all the platforms … our users expect to have the same experience as they have on macOS on all the other platforms."
Electron draws the window on every OS, so the work is in Malini's shell layer: spawning commands, paths and line endings, installs, secrets, links, menus, the browser's hidden views, updates and packaging.
CI ran unit tests on Linux and e2e on macOS only, so nothing proved a Windows path, a CRLF checkout or a `.cmd` shim (0250).

## Decision

- **Builds for every OS and chip.**
  `apps/malini/electron-builder.yml` builds a dmg for arm64 and universal, and zips for arm64 and x64, so `latest-mac.yml` feeds Intel Macs too; `x64ArchFiles` lets node-pty's two macOS builds sit side by side in the universal app.
  Windows gets one NSIS installer for x64 and arm64, `malini-setup.exe`.
  Linux gets an AppImage, a deb and an rpm for x64 and arm64, named `malini-<arch>.<ext>` with electron-builder's arch names (`x86_64`, `amd64`, `aarch64`, `arm64`), from the maintainer `Bestboy <hey@bestboy.dev>`, and the deb and rpm depend on `git`.
  `pnpm dist` runs `scripts/dist.mjs`, which builds the host's unpacked app through electron-builder's API with a real `publish: null`, since the CLI turns `-c.publish=null` into a provider named `null`.
- **A release builds on every OS (amends 0008).**
  The `release` job in `.github/workflows/ci.yml` runs on macOS, Ubuntu 24.04 and Windows.
  Each runs `pnpm --filter malini release` and opens its build with `scripts/packaged-smoke.mjs`, and macOS signs and notarizes both disk images.
  `publish` downloads every `release-*` artifact and uploads every `malini-*` file and `latest*.yml` with `gh release create`.
  `apps/site/src/lib/links.ts` links each download to `releases/latest/download/<file>`: the universal dmg first, the Apple silicon dmg beside it, the Windows installer, and the deb, rpm and AppImage for each Linux chip.
- **Updates on every OS.**
  `startUpdates` in `src/lib/app/platform/updates.ts` takes the platform.
  macOS stages on Squirrel's `update-downloaded` and offers the move to Applications.
  Windows and Linux stage on electron-updater's own `update-downloaded` and never call `app.isInApplicationsFolder()`, which exists only on macOS.
- **OS words and keys come from one place.**
  `osFor(platform)` in `$shared/os` holds every word and key that differs: the file manager, the keychain and secret store, the tray, the Trash, Quit or Exit, Cmd or Ctrl and their shortcuts, and the Claude Code install command (`irm https://claude.ai/install.ps1 | iex` on Windows).
  The renderer reads the platform once, through `platformOs()` in `$shared/port`.
- **Menus and tray per OS.**
  Off macOS the window carries a File menu and a Help menu with About in it.
  The tray icon opens Malini on a click, and its menu adds Open and Quit, which Windows calls Exit.
- **One way to spawn.**
  `src/main/process/command.ts` resolves an executable through `PATH` and, on Windows, `PATHEXT`.
  It runs a `.cmd` or `.bat` shim through `ComSpec /d /s /c` with verbatim arguments, and reads environment names without case on Windows.
  Every spawn of git, gh, docker and claude goes through it, child windows stay hidden, and a process tree stops with `taskkill /T /F` on Windows.
  The default shell is `/bin/bash` on Linux and `/bin/zsh` on macOS when `$SHELL` is unset.
- **Installs per OS (amends 0242).**
  `ghBuild` in `src/main/process/gh-install.ts` picks the `gh` release archive for the platform and arch, a zip on macOS and Windows and a tar.gz on Linux, checks it against `GH_SHA256` for six builds, and unpacks it with the system `tar`.
  `scripts/fetch-gh.mjs` puts both arches in `vendor/gh/<mac|win|linux>-<arch>`, and `extraResources` copies the one for each build into `Resources/vendor/gh`.
  `claude-install.ts` downloads the Claude Code build for the platform and arch, and the bridge looks for `claude.exe` under `USERPROFILE` on Windows.
- **Links open Malini.**
  A `malini://` link reaches the running Malini as a second instance's arguments on Windows and Linux.
  Linux claims the scheme with a `.desktop` entry and `xdg-mime` (`src/main/url-scheme.ts`), and Windows sets the AppUserModelId its notifications need.
- **Secrets on Linux.**
  `src/main/password-store.ts` asks Chromium for `gnome-libsecret` unless the desktop is KDE, no D-Bus session exists or the window runs in the background, and the last `--password-store` argument wins.
  A `basic_text` store counts as no store, so Malini never seals a secret with Chromium's fixed key.
- **A hidden browser view stays in its window off macOS (amends 0234).**
  Linux and Windows paint no view taken out of its window.
  So a view the user does not see keeps only its corner pixel inside the window, which the 8 px rounding hides, and its page keeps drawing frames (`cornerPixelInside` in `src/lib/browser/platform/views.ts`).
- **Exact bytes in git.**
  Checkpoint snapshots and restores, archived-work restores and the brain run git with `core.autocrlf=false`, so a restore on Windows keeps every byte.
  `.gitattributes` keeps the repository LF, except `.bat` and `.cmd`.
- **Paths.**
  `PATH_SEPARATORS` in `src/main/fs/paths.ts` splits on both separators on Windows, so the permission checks and image paths see every segment, and the worktree file server refuses `.malini` under either separator.
  Real paths come from `realpathSync.native`.
- **Smaller seams.**
  Copy-on-write uses `fs.cp` with `COPYFILE_FICLONE` on Windows, and atomic writes skip the directory fsync Windows refuses.
  Open folder uses Electron's `shell.openPath`.
  Streaming detection lists programs with `ps` or `tasklist`, and the system label reads `/etc/os-release` on Linux.
- **Leftovers stop on Windows too (amends 0082).**
  `stopLeftovers` lists Windows processes with PowerShell's `Get-CimInstance Win32_Process` in place of `ps`, and counts a process as orphaned when its parent is gone or started after it, since Windows reuses process IDs.
  A path there matches without case and with either separator.
  A Windows process has no tty, so a second PowerShell asks each candidate's console for its window with `AttachConsole` and `GetConsoleWindow`: a window the user sees, or the `PseudoConsoleWindow` of a pseudoconsole terminal, keeps the process running, as a tty does on macOS, while Malini's own consoles are hidden and have none.
  When that check fails, nothing is stopped.
  `process.kill` ends a Windows process with exit code 1 and no signal, which `archive-restore.spec.ts` expects there.
- **Stats read one process table on Windows.**
  Windows has no `ps`, `top` or `lsof`, so one PowerShell, started with the first sample and stopped with the sampler, compiles `Malini.ProcessTable` with `Add-Type` and writes the whole process table every 5 seconds (`src/lib/stats/platform/windows-process-table.ts`).
  One `NtQuerySystemInformation` call gives each process its parent, its private working set, which is the memory Task Manager shows, and its CPU time, from which Malini takes CPU as the share of one core since the last table.
  For each new process it adds the command line, and for Malini's own processes the working directory from the process's PEB, so the breakdown names Electron helpers and places each agent in its workstream, as `ps` and `lsof` do on macOS.
  Between tables it waits on Malini's process, so it ends with Malini even though Windows lets a write to a closed pipe succeed.
  A PowerShell started for each sample would cost its start-up CPU every 5 seconds.
- **The sandbox stays on macOS for now (amends 0167).**
  `canSandbox()` is still darwin with `sandbox-exec`, so Linux and Windows run agent commands and installs unconfined, as 0167 describes for Linux CI.
  There Sandboxed access falls back to Claude Code's `acceptEdits` and asks before every command, Auto is Claude Code's auto mode, and Full access runs everything unasked, as on macOS.

## Consequences

- Intel Macs, Windows and Linux download from the site and update in place, from the same release.
- Windows builds ship unsigned on purpose, so SmartScreen warns on the first download and Smart App Control blocks Malini.
  Azure Artifact Signing takes individuals only in the US and Canada, and SignPath Foundation needs a hand approval for each release, while Malini ships about 25 a week.
  Certum's Open Source code signing in the cloud, about €49 a year, is the route once Windows users ask for a signed build.
- An AppImage cannot set up Chromium's sandbox helper on Ubuntu 24.04 and later, while the deb and rpm install scripts load an AppArmor profile for it, so the site leads with the deb.
- Sandboxed access does not confine commands on Linux and Windows, and its description still says it does; a sandbox for each of them is the next step to parity.
- A command the user runs from the checkout in their own terminal keeps running on every OS, and a terminal still working inside the checkout on Windows makes archive report the checkout in use, since Windows does not move a folder in use.
- Stats on Windows keep one hidden PowerShell for as long as Malini runs, and where PowerShell runs in Constrained Language mode, `Add-Type` fails and Stats stays empty.
- What must stay true: every word that names an OS thing comes from `osFor`, every spawn goes through `command.ts`, and every git call that writes a checkout passes `core.autocrlf=false`.
- Enforced by the unit and e2e matrices on macOS, Linux and Windows and the `package` job (0250), and by `os.test.ts`, `command.test.ts`, `gh-install.test.ts`, `claude-install.test.ts`, `leftovers.test.ts`, `windows-process-table.test.ts`, `password-store.test.ts`, `url-scheme.test.ts`, `system-label.test.ts`, `updates.test.ts`, `views.test.ts`, `snapshots.test.ts` and `worktree-files.test.ts`.
