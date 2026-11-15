---
title: Install
description: Download Malini for macOS, Windows or Linux, pick a GitHub repository, and start. Claude Code installs itself.
---

## Requirements

- macOS 13 or later, on Apple silicon or Intel.
- Windows 10 or later, on x64 or Arm64.
- Linux on x64 or Arm64, with bubblewrap 0.8 or later for the sandbox.
- git. On macOS it comes with the Command Line Tools, and without them Malini says to run `xcode-select --install` in Terminal. On Linux, Malini names the install command for your package manager. On Windows, Malini installs it.

Malini ships the GitHub CLI, installs Claude Code on its own if you don't have it, and on Windows does the same for git.

## Install

1. Download Malini for your OS and install it, as below.
2. Open it.
3. Pick where your code is under **What are we working on?**: **GitHub**, **A folder on this Mac** or **New repository**.
   Malini starts a workstream in it and opens that workstream.

### macOS

[Download Malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-universal.dmg) and drag it to Applications.
It runs on Apple silicon and Intel; [malini-arm64.dmg](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg) is a smaller download for Apple silicon only.

### Windows

[Download Malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-setup.exe) and open it.
One installer covers x64 and Arm64, and it installs Malini for your account alone, in `%LOCALAPPDATA%\Programs\Malini`, without an administrator prompt.
Malini for Windows is not signed yet, so SmartScreen may stop it with **Windows protected your PC**.
Click **More info**, then **Run anyway**.

Malini needs git, and Claude Code runs its commands in Git Bash.
A Git for Windows you installed comes first.
Without one, Malini downloads PortableGit 2.56.1 from the Git for Windows releases on GitHub as it opens, checks it against a pinned checksum, and unpacks it into `%APPDATA%\malini\vendor\git`, with no installer and no administrator prompt.
A line under the picker shows the download, and clones wait for it.
A prompt you send before it lands waits above the composer under **Installing Git for Windows. Your prompt sends once it is in**, and sends on its own once it is.
A failed install says why and offers **Try again**.

### Linux

Pick the package for your distribution and chip:

| Distribution   | x64                                                                                                           | Arm64                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Debian, Ubuntu | [malini-amd64.deb](https://github.com/bestboyhq/malini/releases/latest/download/malini-amd64.deb)             | [malini-arm64.deb](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.deb)           |
| Fedora, RHEL   | [malini-x86_64.rpm](https://github.com/bestboyhq/malini/releases/latest/download/malini-x86_64.rpm)           | [malini-aarch64.rpm](https://github.com/bestboyhq/malini/releases/latest/download/malini-aarch64.rpm)       |
| Any other      | [malini-x86_64.AppImage](https://github.com/bestboyhq/malini/releases/latest/download/malini-x86_64.AppImage) | [malini-arm64.AppImage](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.AppImage) |

Install a `.deb` with `sudo apt install ./malini-amd64.deb`, or an `.rpm` with `sudo dnf install ./malini-x86_64.rpm`; both bring git and bubblewrap with them.
An AppImage needs both installed first: run `chmod +x malini-x86_64.AppImage` once, then open it.

Ubuntu 23.10 and later block the user namespaces that Chromium's sandbox and bubblewrap need, so the AppImage does not start there.
The `.deb` allows them for Malini alone.
To run the AppImage anyway, allow them for every app until the next restart with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.

## First launch

Malini opens on **What are we working on?**, with three rows and nothing to set up first.

- **GitHub.** The card turns into your five GitHub repositories pushed to last, and **Back** returns to the rows.
  Pick one and Malini clones its own copy, starts a workstream in it and opens that workstream.
  Your own checkouts stay as they are.
  **More repositories** opens **Find a repository** in the command center (**⌘K**, or **Ctrl+K** on Windows and Linux), where you type to search the rest, and a pick there starts a workstream too.
  The sidebar comes back with that workstream.
- **Signed out of GitHub.** A `gh` you already signed in to on this computer counts, so the list shows at once.
  Otherwise **GitHub** shows a one-time code, puts it on your clipboard and opens GitHub in your browser, then lists your repositories once you paste it there.
  The sign-in asks for the `workflow` scope too, so agents can change your GitHub Actions workflows.
  If GitHub does not answer in 15 seconds, the card says so and offers **Try again**.
- **A folder on this Mac** (**⌘O**, or **Ctrl+O**) starts a workstream in a repository already on your computer.
  On Windows it reads **A folder on this PC**, and on Linux **A folder on this computer**.
- **New repository** makes one on GitHub under you or one of your organizations, private unless you untick it, and starts a workstream in it.
- **Send while it copies.** A prompt you send while the first copy runs waits above the composer and runs once the copy is done.
- **Claude Code installs itself.** If Claude Code is missing, Malini downloads the latest release from Anthropic as it opens, checks it against the checksum Anthropic publishes, and sets it up in `~/.local/bin`, the same place Anthropic's install script puts it.
  Nothing on the first screen shows it.
  It installs only when Claude Code is missing, never when the check itself fails, so it does not put a second copy beside one from Homebrew or npm.
  A prompt you send before it lands waits above the composer under **Installing Claude Code. Your prompt sends once it is in**, sends on its own once it is, and the top bar says **Needs you** meanwhile.
  A failed install says why and offers **Try again**, and Settings, Providers has Anthropic's install command to run in Terminal, or PowerShell on Windows, instead.
  Malini never asks you to sign in to Claude up front: the first prompt you send on a Claude model asks for the sign-in, and a DeepSeek or OpenCode model asks for its API key instead.
- **The GitHub CLI ships inside Malini.** You don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
  If the bundled one cannot run, Malini downloads the same `gh` from GitHub on its own, checks it, and puts it in place, while **GitHub** reads **Loading your repositories**.
- **Usage stats.** The picker says that Malini shares usage stats, never your code or chats, and that you turn it off in Settings.
- **Somewhere to start.** A new workstream opens on the steps Malini took to set it up, then [prompts to start from](/malini/docs/workstreams.md#before-the-first-message) under **Quick suggestions**, such as **Run it in the browser** and **Plan a change with me**.
  Each one fills the composer with its prompt, for you to edit or send.
  The agent works on the workstream's own branch, so nothing reaches main until you merge.
- **Sounds.** The first time an agent finishes, a note says what that sound means, **Play again** plays it again, and **Change** opens Settings, Sounds.
- **Defaults.** A new install starts with **Resolve merge conflicts**, **Address review comments** and **Update from main** on **Touches my files**, and the [second brain](/malini/docs/brain.md) off.
  Settings, Automations has the [same switches](/malini/docs/automations.md#defaults).
- **Where you heard about Malini.** Once you archive your first merged workstream, the Repositories page asks, once: Hacker News, YouTube, Twitter, GitHub, Reddit, ChatGPT, Claude, Google, a friend or somewhere else.
  Until you pick one or close it, that question is all the page shows.
  The option you pick rides along with the usage data, so we can tell which places bring builders who stick around; what you type for somewhere else stays on your computer.
  The × closes it for good.

## Updates

Malini updates itself.
Updates download in the background and install when you quit, or right away with **Restart to update** at the bottom of the sidebar.
See [Updates and compatibility](/malini/docs/updates.md).

## Build from source

You need Node 24, on macOS, Windows or Linux.

```sh
git clone https://github.com/bestboyhq/malini && cd malini
corepack enable pnpm
pnpm install
pnpm dev
```

On Windows, run `git config --global core.longpaths true` before you clone, since some paths in the repository are longer than 260 characters.
There, `corepack enable pnpm` needs an administrator terminal when Node is installed in `Program Files`.

`pnpm dev` starts the app with hot reload.
`pnpm dist` builds the unsigned, unpacked app for your OS under `apps/malini/release/`: `Malini.app` on macOS, `Malini.exe` on Windows and `malini` on Linux.
