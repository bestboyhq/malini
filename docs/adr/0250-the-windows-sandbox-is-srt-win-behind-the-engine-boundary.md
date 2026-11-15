# 0250 - The Windows sandbox is srt-win, behind the engine boundary

Status: accepted

## Context

0248 shipped Malini for Windows with the sandbox on macOS only, and 0249 put Linux behind a per-OS `SandboxEngine`, so on Windows `canSandbox()` stayed false and Sandboxed asked before every command.
Windows gives an unprivileged process nothing like Seatbelt or bubblewrap: confining a command takes a second account, file ACLs, Windows Filtering Platform filters and a secondary logon, and setting those up takes one elevated install.
`@anthropic-ai/sandbox-runtime` 0.0.83 ships that whole boundary for Windows as `srt-win`, a native helper per chip, and a library that drives it.
The brief for the Windows port said not to hand-roll a security boundary that srt already ships, and to write Malini code only for the mapping and for what srt cannot express.
0249 rejected srt on Linux because its engine is async with in-process state and the run script needs a synchronous prefix; on Windows a forwarder script closes that gap, and the state stays in the bridge.
This amends 0167, 0248 and 0249; the macOS and Linux engines and their lines stay as they were, byte for byte.

## Decision

- srt provides the `srt-sandbox` account and its stored credential, the WFP filters keyed on its SID with loopback allowed, the read grant on the tool folders in the profile with its exclusions, the ACL grants and how they rank, the egress check, the HTTP and SOCKS proxies, the command line that runs a command as the account, and install and uninstall.
  Malini adds the mapping from `SandboxRules`, the forwarder, the problem mapping, the denial parser and the setup flow in Settings.
- `packages/agent-bridge/src/sandbox/windows.ts` is the `win32` row of `ENGINES`.
  It loads srt from `MALINI_SANDBOX_RUNTIME`, which the main process sets to the packaged `resources/agent-bridge/node_modules/@anthropic-ai/sandbox-runtime` (`src/lib/shared/providers/platform/windows-sandbox.ts`), or else from the bridge's own `node_modules`.
  It runs `vendor/srt-win/<x64|arm64>/srt-win.exe` and the Git Bash that 0252 provides.
- `prefix(rules)` hashes the rules into a key, starts preparing that key once in the background, and returns `[<Git>/usr/bin/bash.exe, <temp>/malini-srt-<pid>/forwarder.sh, <key>, <checkout>/.malini/sandbox/tmp, --]`.
  Preparing grants the ACLs, checks the egress fence once per bridge, opens the proxy when the internet is on, and writes srt's command line to `<key>.ready`, or the reason to `<key>.failed`.
- The forwarder waits for one of the two.
  On a failure it prints "malini: the sandbox could not start: <reason>, so this command did not run" and exits 125, so no command runs unconfined.
  Otherwise it writes the command and the user's variables, without the ones that name the user, their folders, the shell, git config or a proxy, into a command file in the scratch folder, and execs srt-win, which runs that file in Git Bash as `srt-sandbox`.
- `write` is granted writable, and srt drops the paths that do not exist.
  `readOnly` is denied writing; a missing `.claude` or `.mcp.json` at a repository's top, or a missing `hooks`, gets an empty folder in its place, since srt can deny only a path that exists, and a missing `commondir` or `gitdir` is left alone, since git would read a placeholder.
  `closed` is denied reading where it exists, and srt-win's folder and Git are granted readable when they are in the home folder.
  A session refuses to start when a writable path holds srt-win or Git, or reaches one of the profile grant's exclusions.
- With the internet off, the filters block every connection of the account except loopback, so localhost works both ways, as on macOS.
  With it on, the command gets srt's proxy variables for an allow-all HTTP and SOCKS proxy on `127.0.0.1`, with a token per bridge.
- `problem()` answers `missing` when srt or Git Bash is missing, `blocked` when srt-win cannot report or Secondary Logon is off, `not-set-up` when the account, its credential, the filters, loopback or the profile grant is missing, `outdated` when the install or the profile grant is older than this srt, and `null` otherwise.
  `sandboxProblemLine(problem, platform)` gives Windows its own lines, for example "Malini's sandbox is not set up on this PC yet, so every command asks first. Set it up in Settings, Agent access."
- Settings, Agent access shows a **Sandbox** card on Windows only (`WindowsSandboxSetup.svelte`).
  **Set up** and **Update** call `providers.set-up-sandbox`, which runs srt's install with loopback allowed behind one Windows prompt and emits `providers:sandbox-setup-progress` while the profile grant runs.
  **Replace** repeats it with `replace: true` after another app's install conflicts, and **Remove** calls `providers.remove-sandbox`, which runs `srt-win uninstall`.
  Both commands answer `done`, `cancelled`, `conflict`, `busy`, or `failed` with a reason, with the fresh problem, and both refuse on macOS and Linux.
- The NSIS uninstaller runs `srt-win acl forget --all` for each chip (`apps/malini/build/installer.nsh`).
- `sandbox.ts` carries a `win32` policy beside the macOS and Linux ones.
  It names the Windows credentials, user data, shell and startup files, the folders every app shares, the caches and the tool-state folders under `AppData`.
  It also names the path separator, so every grant check splits, compares and walks Windows paths as Windows paths.

## Consequences

- A package an agent runs on Windows gets the checkout, the folders it is granted and the tool folders it can read, not Documents, Desktop, Downloads, the profile's sign-ins or the user's processes.
- The account is shared: every chat, and every other app that uses srt on the PC, runs as the same `srt-sandbox`, and **Replace** and **Remove** change the install for all of them.
- Write grants on a checkout outlive the bridge, as srt keeps them, until the uninstaller's `acl forget --all` removes them, and **Remove** says the sandbox is in use while a running bridge holds grants, until Malini restarts.
- The first command of a session waits for its grants, which can outlast the command's timeout in a large checkout; the next command runs once they are done.
- The proxy token is on srt-win's command line, and every localhost listener is reachable from a command.
- With the internet on, the proxy connects directly, so a proxy the PC needs is not used, and a tool that reaches the network through Windows itself instead of the proxy variables, such as System32's `curl` or cargo, cannot get out.
- Reads and socket connections produce no card on Windows, as on Linux; write denials come from the command's output through `denials(output)`.
- A repository without `.claude` or `.mcp.json` shows an empty folder of that name while chats run commands in it.
- A grant a Windows card offers is a Windows path, so every new closed place has to be named for Windows too, in the `win32` policy, not only for macOS.
- The bridge caches `sandboxProblem()` only once there is no problem, so a chat that started before setup picks the sandbox up without a restart, and a PC without one probes again for each command.
- Enforced by `packages/agent-bridge/src/sandbox.test.ts`, whose Windows grant suite runs on the Windows CI job, and by `packages/agent-bridge/src/sandbox/windows.test.ts`: its denial parser tests run on every OS.
  Its Windows suite, under `describe.runIf(process.platform === 'win32' && canSandbox())`, runs real commands through the run script and Git Bash: a write in the checkout and none outside, a hidden folder it cannot read, git hooks and config it cannot change, localhost with the internet off and no internet, the internet through the proxy, and a process of the user it cannot stop.
  That suite runs only where the sandbox is set up, and CI's Windows jobs do not set it up yet, so nothing in CI proves the confinement.
  `src/main/modules.test.ts` fails when either command has no handler, and `pnpm check` fails when the contract reference is stale.
