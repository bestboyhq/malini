# Packaging

`pnpm dist` builds the unsigned, unpacked app for the machine it runs on under `apps/malini/release/`: `mac-arm64/Malini.app`, `win-unpacked/Malini.exe` or `linux-unpacked/malini`, with `-arm64` or `-x64` where the chip is not the default.
`scripts/dist.mjs` calls electron-builder's API with `publish: null`, so the build carries no update feed and never updates itself; the CLI would read `-c.publish=null` as a provider named `null`.

## What ships

`electron-vite` bundles the main process, the preload and the renderer into `out/`, every dependency inlined but the two in the `dependencies` block of `apps/malini/package.json`.
Those two, `node-pty` and `@xterm/headless`, run **Run**'s terminal (ADR 0257): electron-vite keeps them external, and electron-builder packs them from `node_modules`, with node-pty unpacked from the asar.
node-pty ships prebuilt N-API builds for every OS and chip, so `npmRebuild: false` keeps them, and `files` drops its sources, its Windows debug symbols and the builds for other OSes.
A universal Mac app keeps node-pty's arm64 and x64 builds side by side, which `x64ArchFiles` allows.
Any other dependency belongs in `devDependencies`, inlined by the bundle.

The repository extension is imported as a module and rides inside the renderer bundle, so it needs no packaging of its own.

## The agent bridge

The bridge is the one thing electron-vite cannot bundle: it runs as a child process on Electron's own binary with `ELECTRON_RUN_AS_NODE=1`, so `selectBridgeScriptPath` (in `src/lib/chat/platform/agent/service.ts`) reads it from `resourcesPath/agent-bridge/cli.js` at run time.
`pnpm dist` builds the bridge first, and `extraResources` copies `packages/agent-bridge/dist` there with the bridge's `package.json` beside it.

The bridge's runtime dependencies, the Claude Agent SDK and `zod`, are resolved out of pnpm's symlink farm into `dist/node_modules` by `scripts/copy-runtime-dependencies.mjs`.
electron-builder drops a `node_modules` folder at the root of an `extraResources` source, so `dist/node_modules` is copied by its own entry.
The SDK's platform binaries are overridden away in `pnpm-workspace.yaml`, because the bridge always runs the user's own `claude`.

## The GitHub CLI

Malini reaches GitHub through `gh` (ADR 0014), and a machine may not have it, so the app carries its own.
`scripts/fetch-gh.mjs` downloads the `gh` release archive pinned by `GH_VERSION` for the host OS on arm64 and x64, a zip on macOS and Windows and a tar.gz on Linux, refuses each unless its sha256 matches `GH_SHA256`, and unpacks `bin/gh` (`gh.exe` on Windows) and its `LICENSE` into `apps/malini/vendor/gh/<mac|win|linux>-<arch>`, which git ignores.
`pnpm dist`, `release` and `test:update` run it before electron-builder, and `extraResources` copies the build's own folder to `Resources/vendor/gh`; a universal Mac app merges both into one `gh`.
At boot the main process appends `Resources/vendor/gh/bin` to `PATH`, so a `gh` the user installed still comes first.
To move to a newer `gh`, change `GH_VERSION` and all six hashes in `GH_SHA256` together, taking them from the release's `checksums.txt`.

## Git for Windows

Git for Windows is not bundled.
Malini downloads the pinned PortableGit at runtime, only on a Windows PC without git or Git Bash (ADR 0262).
To bump it, change `GIT_VERSION` and both `GIT_SHA256` entries in `apps/malini/src/main/process/git-install.ts`, with the SHA-256 lines from the release notes on `github.com/git-for-windows/git/releases`.

## The commands sandbox on Windows

On Windows, the commands sandbox is `srt-win.exe` from the pinned `@anthropic-ai/sandbox-runtime` in the bridge's `node_modules`.
Only a Windows build keeps it, for its own chip, at `resources/agent-bridge/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/<arch>/srt-win.exe`.
Every build drops the rest of that package's `vendor` folder, because Malini does not use it.
srt-win.exe is unsigned, as the rest of the Windows build is.
Its Apache-2.0 `LICENSE` ships beside it in `agent-bridge/node_modules`.
The uninstaller runs `srt-win acl forget --all`, from `build/installer.nsh`, which removes the write grants the sandbox kept on checkouts, and an update skips it.
It leaves the shared srt-win install in place: the `srt-sandbox` account, its network filters and the profile read grant.
Another app can use that install, so only Settings, Agent access removes it (ADR 0260).

## RTK

Malini shortens what an agent's commands print with RTK, in the Apache-2.0 `rtk-oss` build (ADR 0248).
`scripts/fetch-rtk.mjs` downloads the build pinned by `RTK_VERSION` for this machine, refuses it unless its sha256 matches its row in `RTK_BUILDS`, and puts `bin/rtk`, its `LICENSE` and a `VERSION` file into `apps/malini/vendor/rtk`, which git ignores.
`pnpm dist`, `release` and `test:update` run it before electron-builder, `pnpm dogfood` runs it after `pnpm install`, CI runs it before the package tests, and `extraResources` copies the folder to `Resources/vendor/rtk`.
The bridge gets that path in `MALINI_RTK_BINARY`, and a missing binary only means commands print in full.
Malini never downloads RTK at run time, and never ships the default `rtk` build or `rtk-proxy`, which are BUSL-1.1.
To move to a newer RTK, change `RTK_VERSION` and every sha256 in `RTK_BUILDS` together, taking each hash from the release's `checksums.txt`.

## Licenses

`extraResources` ships Malini's `LICENSE` and the root `NOTICE`, which names every third-party component with its license and copyright line.
Each bundle in `out/` carries a `THIRD_PARTY_NOTICES.txt` with the license of every npm package whose code or assets it contains, generated at build time by `scripts/third-party-notices.mjs`.
The build fails when a bundled package declares no license, or when `NOTICE` has no line starting with its name: add the package there with its license and copyright line.
electron-builder ships Electron's `LICENSE.electron.txt` and Chromium's `LICENSES.chromium.html` with every build, in `Contents/Resources` on macOS.
The About panel shows the copyright, the AGPL notice, the source link, and these credits, from `aboutPanel` in `src/lib/app/platform/menu.ts`.
The SDK carries its own `LICENSE.md` inside `agent-bridge/node_modules`, `gh` its MIT `LICENSE` inside `vendor/gh`, and RTK its Apache-2.0 `LICENSE` inside `vendor/rtk`.
The sounds in `src/renderer/public/sounds` ship with their `LICENSE.md`, which credits each file and links its license, and the Apache 2.0 text beside it.
`pnpm licenses list -r` lists every dependency in the workspace with its license; anything copyleft, non-commercial, or unlicensed needs a decision before it ships.

## Releases

Every push to `main` runs `apps/malini/scripts/version.mjs`, which reads the Conventional Commit subjects since the last `v*` tag.
A breaking change (`!` or a `BREAKING CHANGE:` footer) bumps the major, a `feat` the minor, a `fix` or `perf` the patch; anything else releases nothing.
The first release is `0.1.0`, and `package.json`'s version is a placeholder CI overwrites.
`.github/workflows/pr-title.yml` keeps PR titles in that shape, since a squash merge makes the title the subject.

The `release` job builds on macOS, Linux and Windows while the tests still run; on macOS it signs with the Developer ID certificate and notarizes the app and both disk images.
The hardened runtime gets `build/entitlements.mac.plist`: electron-builder's defaults plus `com.apple.security.device.audio-input`, so recording a sound can ask for the microphone, and `NSMicrophoneUsageDescription` says why.
Each then opens its build once with `scripts/packaged-smoke.mjs`, waits for it to boot to Repositories, and starts a terminal from the packaged node-pty.
The `update` job runs `pnpm --filter malini test:update` on its own runner at the same time, when a file the test covers changed since the last release (ADR 0081).
Once the release passes and no check or test of the push failed, the `publish` job runs `gh release create` with every `malini-*` file and `latest*.yml` the three builds made.
The macOS build needs the repository secrets `CSC_LINK` (the base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`; the Windows and Linux builds are unsigned.
The bundle takes the product name from `productName` in `apps/malini/package.json`, `Malini`, while every file a release publishes keeps the lowercase identifier: `electron-builder.yml` spells out `artifactName` for every target (ADR 0033).
The disk images are `malini-universal.dmg`, for every Mac, and `malini-arm64.dmg`, for Apple silicon, without a version, so `releases/latest/download/<file>` always serves the newest release; the site and the README's download button link there.
The zips are `malini-<version>-arm64-mac.zip` and `malini-<version>-x64-mac.zip`, and `latest-mac.yml` points the update feed of each chip at its own.
Windows gets `malini-setup.exe`, one installer for x64 and arm64, with `latest.yml`.
Linux gets `malini-<arch>.AppImage`, `.deb` and `.rpm` for x64 and arm64, with electron-builder's arch names (`x86_64`, `amd64`, `aarch64`, `arm64`), and `latest-linux.yml` and `latest-linux-arm64.yml`.
`pnpm --filter malini release` builds the host OS's artifacts locally; on macOS they are signed with the keychain's Developer ID, and notarized only when `APPLE_KEYCHAIN_PROFILE` is set.

Every pull request runs the `package` job on macOS, Linux and Windows (ADR 0256).
It builds the app with `pnpm dist` on macOS, where signing needs the release secrets, and the installers with `pnpm release` on Linux and Windows, then opens each build with `scripts/packaged-smoke.mjs`.
The Linux and Windows installers stay on the run as a seven-day artifact, to try on a real machine.

## The disk image

The dmg mounts as `Malini` and opens on `build/background.png` and its 2x twin, which `pnpm --filter malini generate:dmg-background` renders from `build/background.html` in Electron.
To change the window, edit the HTML, rerun the command, and commit all three files.
Finder draws an icon's label in black over any background, so the white pills sit where it puts the labels of the icons at (130, 220) and (410, 220).
The window is the image's size with the title bar inside it, so the bottom 33 points never show.
Finder shows `.background.tiff` and `.VolumeIcon.icns` to anyone who shows hidden files, so `dmg.contents` parks both at y 1000, below the window.
That takes the `position` type electron-builder 27 adds, and `patches/` adds it to the schema of electron-builder 26 until then.

## Updates

`electron-builder.yml` publishes to GitHub Releases and bakes the feed into the app as `app-update.yml`.
`src/lib/app/platform/updates.ts` checks on launch, every hour and on wake, and downloads in the background; Squirrel.Mac verifies the Developer ID signature and installs the update when Malini quits.
On Windows electron-updater stages the NSIS installer, and on Linux the AppImage, deb or rpm Malini was installed from, and installs it when Malini quits; a deb or rpm asks for an administrator password then.
It keeps checking once an update is staged, and stages a newer release over it, since `main` can ship several releases a day.
The app menu offers only Check for Updates…; every update status shows at the bottom of the sidebar and never in a dialog.
A check you asked for shows there as checking, downloading, up to date or failed with Retry, a check of its own stays silent, and once an update is staged Restart to update checks once more and installs the newest release.
Squirrel cannot replace an app outside an Applications folder, so a packaged Malini started elsewhere on macOS offers to move itself there.

`pnpm --filter malini test:update` builds 0.0.1, 0.0.2 and 0.0.3 under their own name and app id, serves them from a local feed, and proves both paths: quitting 0.0.1 with 0.0.2 staged installs 0.0.2, and Restart to update, once the feed has moved on to 0.0.3, installs and relaunches 0.0.3.
In between, 0.0.2 picks Check for Updates… against a slowed, then failing, then newer feed, and the sidebar shows checking, up to date, failed with Retry, and the download of 0.0.3.
0.0.1 carries the lowercase product name, the way every release before the rename shipped, and 0.0.2 the capitalized one, so the run also proves that an installed lowercase bundle takes the renamed update in place and that 0.0.2 opens the data folder of 0.0.1 and decrypts a secret 0.0.1 sealed.
The builds carry `MALINI_BACKGROUND_WINDOW` in `LSEnvironment`, so the relaunched app stays behind every window too.
It needs a Developer ID identity in the keychain, because Squirrel installs only signed updates.
