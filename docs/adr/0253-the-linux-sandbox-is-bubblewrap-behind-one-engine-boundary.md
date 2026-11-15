# 0253 - The Linux sandbox is bubblewrap, behind one engine boundary

Status: accepted

## Context

0167 put every agent command and every workstream install in a Seatbelt profile Malini writes, and 0252 shipped Malini for Linux and Windows with that sandbox still macOS only.
On Linux, `canSandbox()` was false, so Sandboxed, Auto and Full all ran commands as the user, with nothing between a package an agent installs and `~/.ssh`.
A second OS needs a second mechanism, not a second policy: what counts as a credential, a cache or a protected git file is the same decision on every OS, and only the way to enforce it differs.
`@anthropic-ai/sandbox-runtime` was read and rejected: its Linux engine is a per-command async library with in-process state, its seccomp helper always blocks AF_UNIX sockets, and its network layer swaps localhost for proxies, so it cannot sit behind the `CLAUDE_CODE_SHELL_PREFIX` run script that masks secrets and mints one-time passes.
Its bubblewrap flags are good, so Malini uses them and adds no dependency.
This amends 0167, 0172, 0191, 0193 and 0252; Seatbelt's profile and every macOS behavior stay as they were, byte for byte.

## Decision

- `packages/agent-bridge/src/sandbox.ts` keeps one policy and resolves a session's places into plain data.
  `sandboxRules(places, home, temp, platform)` returns `write`, `readOnly`, `closed`, `sockets` and `internet` as canonical paths, from a `Policy` per OS (`POLICIES.darwin`, `POLICIES.linux`) that names credentials, user data, the files that run outside the sandbox later, shared folders, caches and temporary folders.
- A `SandboxEngine` is `{ problem(), prefix(rules), denials?(output) }`, and `ENGINES` maps a platform to one: `darwin` to Seatbelt, `linux` to `sandbox/bubblewrap.ts`.
  Seatbelt's `prefix` is `[sandbox-exec, '-p', sandboxProfile(places, home, temp)]`, so the profile text is unchanged.
  An engine module imports only types, so there is no cycle, and a platform with no engine reports `'unsupported'`.
- The run script reads the prefix as NUL-terminated words from `<session>/sandbox`, or from a one-time `passes/<32 hex>.sandbox`, and runs `/usr/bin/env ELECTRON_DISABLE_SANDBOX=1 <words...> "$shell" -c "$command"`.
  An empty word list refuses the command with "malini: the sandbox is not ready, so this command did not run", so a half-written file never runs a command unconfined.
- The Linux prefix is `bwrap --new-session --die-with-parent --unshare-pid --unshare-user --disable-userns --cap-drop ALL --ro-bind / / --dev /dev --proc /proc`, then `--unshare-net` when the internet is off, `--bind-try` per writable path, `--ro-bind-try` per protected path, `--tmpfs X --remount-ro X` per closed folder, `--ro-bind /dev/null X` per closed file or socket, and `--bind-try` per socket a card opened.
  Only paths that exist are hidden, since bwrap creates a missing mount point on the host.
  Every path in the prefix is resolved to its real path and deduped, since bwrap makes a mount point without following a symlink and refuses to start when a parent of it is one: `/var/run/docker.sock`, under the `/var/run -> /run` link every modern Linux has, stopped every sandboxed command.
  The display folders `/tmp/.X11-unix` and `/tmp/.ICE-unix`, the docker, podman and system dbus sockets, and `$XDG_RUNTIME_DIR` are covered or replaced with a fresh tmpfs, so no key agent, session bus, secret service, display server or container daemon is reachable.
- Protected paths are each git folder's `hooks`, `config`, `config.worktree`, `commondir` and `gitdir`, a `.git` pointer file, `.claude` and `.mcp.json`, in the checkout and in every granted folder.
  Writable paths are the checkout, its git folders, `/tmp`, `/var/tmp`, `~/.cache`, `~/.npm`, `~/.local/share/pnpm` and what a grant opened; Linux creates those cache folders first, since bwrap cannot bind a folder that does not exist.
- Linux reads denials from the command's own output, since the kernel logs none: `denials(output)` keeps lines that match `read-only file system` or `EROFS`, takes the last absolute path in the line as the target, and reports the first denial per target as `file-write-create`.
  `session.ts` tags them and feeds them to the same `sandboxGrant` cards and `toolStateGrant` grants the macOS log stream feeds.
- `sandboxProblem()` is answered by the engine, and cached per process only once there is no problem: `missing` when `bwrap --version` fails, `outdated` below 0.8, `null` when the base flags run `/bin/true`, `nested` when `/.dockerenv` or `/run/.containerenv` exists, and `blocked` otherwise.
  The main process exposes it as `providers.sandbox-problem`, and Settings, Agent access replaces the Sandboxed description with one line that names the reason and the fix, for example "Malini's sandbox needs bubblewrap, so every command asks first. Install bubblewrap, then restart Malini."
  A command is never silently unconfined: with any problem, Sandboxed asks before every Bash command, as it did on Linux before.
- The deb and the rpm depend on `bubblewrap` (`apps/malini/electron-builder.yml`).
  electron-builder installs `/etc/apparmor.d/<executable>` with `userns`, so the deb works on Ubuntu 24.04 and later; the AppImage and the tarball have no fixed path, so there `sandboxProblem()` is `blocked` and the line names `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
- With the internet on, the command keeps the host network, so localhost works both ways.
  With it off, `--unshare-net` cuts every socket, localhost included.
  pasta and slirp4netns were tried and rejected: pasta needs `/dev/net/tun`, refuses to start without a route, forwards only the ports listening when it starts, binds a forwarded port on `0.0.0.0` on the host, and prints warnings into the command's output.

## Consequences

- A malicious package in a command or an install on Linux gets the checkout and the caches, not `~/.ssh`, the keyring, the browsers' profiles, another bridge's secrets, the session bus or the docker socket.
- Both OSs now share one policy, so a new credential folder or a new protected file is one list entry, and Windows is one engine module and one table row away.
- A Linux chat with the internet off cannot reach its own localhost server, which macOS allows; the UI and this ADR state it, and a chat that needs both turns the internet on.
- With the internet on, a host abstract unix socket stays reachable, since `--unshare-net` is the only cut available.
- `--unshare-pid` means a background process dies when its command ends, so a server an agent starts must run in the same command that uses it.
- Reads and socket connections produce no card on Linux, since only writes leave a message to parse; a command that needs one of those must be allowed out of the sandbox.
- A grant protects its folder's git files and `.claude` at depth 0 only, and a missing `.mcp.json`, `.claude`, `commondir` or `gitdir` in the checkout can still be created, because bwrap cannot bind what does not exist.
  Every checkout Malini makes is a worktree, which carries both git pointers, so they exist and stay read-only; a plain clone someone opens as a folder is the case that keeps the gap.
- A path an automation's boundary hides is closed on Linux only once it exists, for the same reason; it is closed from the next prompt on, since the bridge writes the prefix again each run.
  Covering a mount point that is missing would either fail the command, under the read-only root, or create that file or folder on the host, inside the user's checkout.
- A command can print a fake denial line, which is no worse than causing a real one.
- Enforced by `packages/agent-bridge/src/sandbox.test.ts`, whose bubblewrap suite runs under `describe.runIf(canSandbox() && LINUX)`: reads and writes in the checkout, refused writes to the home folder, `/usr/local`, a git hook and git config, closed credentials and user data, a hidden bridge secrets folder, a granted folder whose hooks stay closed, a folder hidden through a symlinked parent, a kill that cannot reach an outside pid, no agent, bus, docker socket or display, localhost on and off, and the denial parser.
  `src/claude/secrets.test.ts` runs the real run script inside the real prefix, and `provisioning-real-cli.test.ts` installs inside it.
  CI's Ubuntu x64 and arm64 unit jobs install bubblewrap and clear the AppArmor restriction, so those suites run there and nowhere else.
