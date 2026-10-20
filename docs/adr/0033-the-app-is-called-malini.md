# 0033 - The app is called Malini

Status: accepted

## Context

The product is called Malini, capitalized like the org's other apps Grip and Tony, while its identifiers stay lowercase.
Electron takes one name, `productName` from `package.json`, and derives both the name people see and where the app keeps its data from it.
`app.getPath('userData')` is `~/Library/Application Support/<name>`, and safeStorage encrypts with a key kept in the keychain item `<name> Safe Storage`.
Electron 44 reads that name for the keychain in `ElectronBrowserMainParts::PostCreateMainMessageLoop`, after the main script's first tick and before `will-finish-launching`; its default menu reads it on `will-finish-launching`.
Keychain lookups are case-sensitive, and stored worktree paths are compared as strings, so `Malini` is a different name from `malini` even on a case-insensitive disk.
Every installed copy keeps its data, workstreams and worktrees in `~/Library/Application Support/malini`, and its secrets under `malini Safe Storage`.

## Decision

- `productName` in `apps/malini/package.json` is `Malini`, so the bundle is `Malini.app` and the menu bar, the app menu and the About panel say Malini; `electron-builder.yml` no longer repeats it.
  The window title is `Malini`.
- These stay lowercase: package names, the repository, URLs (`bestboy.dev/malini`), command and event names, `window.malini`, `.malini/` folders, storage keys, the app id `app.malini.desktop`, the data folder and the keychain item.
  They are identifiers that data, links and other machines already hold, so renaming them would move or orphan that data.
- `pinStorageName` in `apps/malini/src/main/storage-name.ts` runs first in `src/main/index.ts`.
  It sets the app name to the product name in lowercase, pins `userData` to `<appData>/malini` unless a `--user-data-dir` profile was passed, and gives the product name back in a `will-finish-launching` listener it puts before Electron's own.
  The keychain item stays `malini Safe Storage`, and everything after launch sees `Malini`.
- Release files keep their lowercase names through explicit `artifactName`s: `malini-arm64.dmg` and `malini-<version>-arm64-mac.zip`, which `latest-mac.yml` points at.
- An installed `malini.app` updates as before, from the same feed to a release with the same app id and Developer ID.
  Squirrel.Mac installs an update at the path of the bundle it replaces, so the folder stays `malini.app` while the bundle inside says Malini; installing `Malini.app` from the dmg renames it.

## Consequences

- Existing users keep their data folder, workstreams, worktrees and encrypted secrets with no migration step.
- Electron must keep reading the name for the keychain before `will-finish-launching`; an upgrade that reads it later would seal new secrets under `Malini Safe Storage` and lose the old ones.
- `apps/malini/src/main/storage-name.test.ts` checks the pin, the restored name and that a `--user-data-dir` profile stays put.
- `pnpm --filter malini test:update`, the `update` job in `.github/workflows/ci.yml`, builds 0.0.1 under the lowercase name and 0.0.2 under the capitalized one, and fails unless Squirrel installs 0.0.2 into the lowercase bundle and 0.0.2 opens the data folder of 0.0.1 and decrypts a secret 0.0.1 sealed.
- The `release` job notarizes `malini-arm64.dmg` and the `publish` job uploads `malini-<version>-arm64*` and `malini-arm64.dmg*` by name, so a renamed release file fails them.
