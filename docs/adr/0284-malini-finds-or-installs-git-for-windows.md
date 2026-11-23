# 0284 - Malini finds or installs Git for Windows

Status: accepted

## Context

Malini runs git for every repository and workstream, and Claude Code on Windows runs its commands through Git Bash, which it finds through `CLAUDE_CODE_GIT_BASH_PATH`.
Windows ships neither, and the NSIS installer of 0280 cannot depend on a package the way its deb and rpm depend on `git`.
On a PC without Git for Windows nothing worked and nothing said why, and Malini did not pass the Git Bash it found to Claude Code.
Claude Code without Git Bash runs commands in PowerShell, outside Malini's run script, so outside its sandbox and its secret masking.
On macOS git comes with the Command Line Tools, whose `/usr/bin/git` shim opens Apple's install dialog when they are missing, and on Linux it comes from the package manager.
0242 has Malini install a missing Claude Code or `gh` on its own, once per launch, and this decision adds Git for Windows to them, amending 0242 and 0280.

## Decision

- **Malini's own Git for Windows.**
  `src/main/process/git-install.ts` pins PortableGit `GIT_VERSION` 2.56.1 from `github.com/git-for-windows/git/releases` for x64 and arm64, with a sha256 per chip in `GIT_SHA256`.
  `installGit` downloads it with `saveDownload` into a `.install-*` folder under `<appData>/vendor/git` and checks its hash.
  It runs the self-extractor with `-y -o<folder>` and `windowsHide`, which also runs the archive's post-install step.
  It then checks that `cmd\git.exe` and `bin\bash.exe` are there and that the post-install step left nothing behind, and renames the folder to `<appData>/vendor/git/<GIT_VERSION>`.
  A failure is a `GitInstallError` whose `kind` names the stage: `download`, `checksum` or `unpack`.
  An unpack failure names the exit code or the system error code, such as `EPERM`, and never the paths it ran with.
  An older copy stays usable until the pinned one is in, and `pruneGitHomes` deletes the rest at the next launch.
- **Every spawn finds git, and a system Git wins (amends 0280).**
  On Windows, `useGitForWindows` in `src/main/process/environment.ts` runs at boot in `src/main/index.ts`, before any module registers.
  With no git on `PATH`, it appends the `cmd` folder of a system Git for Windows under `ProgramFiles`, `ProgramW6432`, `ProgramFiles(x86)` or `LOCALAPPDATA\Programs\Git`, or else Malini's own copies, newest first.
  It keeps a `CLAUDE_CODE_GIT_BASH_PATH` whose file exists, else sets the `bin\bash.exe` beside the git it finds or in a system Git, else Malini's own.
  `command.ts`, `resolveToolPath`, the bridge and Claude Code read that `PATH` and that variable.
- **It installs at launch (amends 0242).**
  On Windows, `src/lib/shared/repositories/platform/git-for-windows.ts` starts `installGit` at launch when git or Git Bash is missing, or when the git in use is an older copy of Malini's.
  `repositories.git-setup-status` reads `missing` only on Windows with git or Git Bash missing.
  The first `repositories.install-git` takes the launch attempt, so a launch downloads once, and each later one, **Try again**, starts a new attempt.
  While an install that started with no git on `PATH` runs, every git spawn in `src/main/git/run.ts` waits for it through `holdGitUntil`.
  Progress goes out on `repositories:git-install-progress`.
- **It shows where the other installs show.**
  `installMissingToolsHook` runs `installGitCommand` once per launch when the status reads `missing`.
  `GitInstallStatus` on the picker and the Repositories page reads "Installing Git for Windows. Clones wait for it" with the download bar, or the error with **Try again**.
- **The first prompt waits (amends 0242).**
  `modelAccessQuery` reads `git-missing` while Git for Windows is missing, installing or failed, so the prompt is held.
  `ProviderConnectStrip` then reads "Installing Git for Windows. Your prompt sends once it is in" with the bar, "Git for Windows is not on this PC" with **Install**, or the error with **Try again**.
  `releaseWaitingPromptQueuesHook` sends the prompt once the install is in.
- **macOS and Linux say what to do.**
  Malini installs no git there and runs no git to check for it.
  `gitMissingMessage` in `src/main/errors.ts` is the line a missing git shows.
  On macOS it reads "Git needs the Command Line Tools. Run xcode-select --install in Terminal, then try again.", also when `xcrun` reports an invalid active developer path.
  On Linux it reads "Git is not installed. Run sudo apt install git in a terminal, then try again.", with `dnf`, `pacman` or `zypper` when that package manager is on `PATH`, and "Git is not installed. Install it with your package manager, then try again." when none is.
  On Windows it reads "Git for Windows is not on this PC. Press Try again on the Repositories page."
- **Counts and calls.**
  `repositories.install-git` counts as `tool_install_*` with `tool: git`, from `src/lib/app/platform/usage-tools.ts`.
  The download is Malini's thirteenth outbound call, named in `AGENTS.md`.
- **Tests.**
  `scripts/fetch-portable-git.mjs <folder>` downloads the pinned PortableGit for the host's chip, checks its hash and prints its path, and reuses a file whose hash matches.
  The Windows-only test in `src/main/process/git-install.test.ts` unpacks the file that `MALINI_TEST_PORTABLE_GIT` names, with no network.

## Consequences

- A PC without Git for Windows gets git and Git Bash with no press, at the cost of a 60 MB download at its first launch.
- Claude Code never runs a prompt from Malini in PowerShell for want of Git Bash, since the prompt waits for it.
- A system Git for Windows installed later wins from the next launch, and Malini's copy stays in `<appData>/vendor/git`.
- Malini's copy moves only when a release bumps `GIT_VERSION` and `GIT_SHA256`.
- Only a Windows run proves that the self-extractor and its post-install step open no window.
- `src/main/process/git-install.test.ts` fails when a build, an install stage, the bare code of an unpack failure or the pruning changes.
  On Windows it also fails when the real PortableGit opens a window, leaves its post-install step behind, or gives a git or a bash that does not run.
  The Windows unit jobs must set `MALINI_TEST_PORTABLE_GIT` from `scripts/fetch-portable-git.mjs`, since the test fails rather than skips without it.
- `src/main/process/environment.test.ts` fails when the `PATH` or Git Bash order changes, and `src/main/errors.test.ts` fails when a line per OS changes.
- `tests/e2e/git-for-windows.spec.ts` covers the failed install, **Try again**, the held prompt and git from Malini's folder on Windows CI.
