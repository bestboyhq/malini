# 0125 - Malini has its own extension marketplace on bestboy.dev

Status: accepted

## Context

0123 put contributions (MCP servers, skills and hooks) in the Claude Code plugin format and installed them through Claude Code, because Claude Code already held their configuration and sign-ins.
The user rejected that: "We want our own marketplace ppl can publish to and install from; besides we'll be extending entire malini, not just claude, so why ... would u put it thru claude code?"
Installing through `claude plugin install` ties every extension to one agent runtime and to `~/.claude`, and gives a publisher nowhere to publish.
Bestboy's platform already signs people in to Malini (0121) and hosts Grip's files in R2 behind a separate media origin.
Extension API v1 stubbed managed installs that refused with "Malini has no extension marketplace", and the inspector's Extension directory listed only the built-in Repository extension.
Picking the list layout, the user asked for less structure than one bordered list with dividers, in the language of the Appearance settings.

## Decision

- **The marketplace lives on bestboy.dev.**
  `GET /api/extensions` lists the newest version of every extension and every yanked version, `GET /api/extensions/:publisher/:name` adds the README and the versions, `GET …/versions/:version/package` answers 302 to the media origin, `POST …/versions` publishes as the person's handle with the Bestboy token Malini already keeps, and `DELETE …/versions/:version` yanks.
  The platform's `docs/api.md`, "Extensions", is the contract.
- **A package** is gzip of `{ "format": 1, "files": [{ "path", "data" }] }` holding `malini.json`, an optional `README.md` and `LICENSE`, and `skills/<skill>/SKILL.md` folders: at most 5 MB packed, 10 MB unpacked and 500 files.
  `malini.json` has `apiVersion: 2`, `publisher`, `name`, `version`, `displayName`, `description`, an optional `repository`, and `contributes.mcpServers` with remote `https` servers only.
  Malini and the platform refuse the same packages; Malini's rules are `src/lib/extensions/domain/marketplace-manifest.ts`.
- **Install.** Malini downloads the version the index lists, checks its sha256 and that its `malini.json` names the same publisher, name and version, and swaps it into `<app data>/extensions/installed/<name>/` with `.claude-plugin/plugin.json` and `.mcp.json` added, so the folder is a Claude Code plugin.
  Migration 83 keeps the record in `installed_extensions`; one name holds one extension, so a second publisher's extension of the same name is refused until the first is uninstalled.
- **Every session gets them from Malini.**
  `ExtensionsPlatform.pluginFolders()` gives each prompt the folders of enabled extensions, the bridge passes them as the SDK's `plugins` option (protocol 45), and a changed set relaunches the session with `resume` at its next prompt.
  Malini never writes `~/.claude` and never runs `claude plugin`; the Claude Code plugins you installed yourself keep working as before.
- **Updates and withdrawals.**
  Malini reads the index when Extensions opens and at start while anything is installed, as fresh as the platform's `Cache-Control` allows (five minutes today).
  A newer version that reaches no new host installs itself; one that does waits for **Update**, which names the new hosts.
  An installed version its publisher yanked is turned off and shown as withdrawn.
- **Publishing.**
  Extensions, Published lists each repository whose checkout has a `malini.json`, with its live version.
  **Publish** packs what is committed in `malini.json`, `README.md`, `LICENSE` and `skills/`, refusing uncommitted changes, checks it with the same rules, and uploads it under the person's Bestboy handle.
  Published signs in with the profile's sign-in (0121) and claims a handle without publishing stats.
- **The page.**
  A sidebar footer button opens `/extensions`, with Discover, Installed and Published in the sidebar the way Jobs has its own.
  Each page is a `PageSection` of wells holding separate cards, with no dividers, as in Appearance; `PageSection` moved from Jobs to hyper-ui so both share it.
  The inspector's Extension directory and the managed-install stubs are gone.
- **A fourth outbound call**, beside 0121's three: Malini reads the marketplace index, extension pages and packages from bestboy.dev without a token, only while Extensions is open or something is installed, and sends a package with the person's token only when they press **Publish**.
- Still true from 0123: Malini draws every pixel, no extension code runs in the renderer, agents summon views rather than install them, adapters swap infrastructure behind a port with this Mac's keychain as the first secrets adapter, and the user never picks where something lives.
  Adapters, job recipes and views join `malini.json` when their ports land.

## Consequences

- An extension adds nothing that runs on the Mac: remote servers and skills only, so the listing's servers and hosts are everything it reaches.
  Local (stdio) servers and adapters wait for 0123's sandbox.
- Anyone with a handle publishes at once; trust comes from what the listing shows and from the sha256 check, not from review, and a handle can take any brand's name until the platform verifies publishers by domain.
- The MCP probes behind Settings, MCP servers load the same folders, so an extension's server shows there and signs in like any other; Claude Code keeps that sign-in, so sign-ins stay per runtime until Malini holds them.
- Enforced by `src/lib/extensions/domain/marketplace-manifest.test.ts` (the manifest and package rules), `src/lib/extensions/platform/extension-package.test.ts` (packing, the size and base64 checks), `src/lib/extensions/platform/marketplace.test.ts` (install, the hash check, updates, withdrawals, publishing), the bridge's session and protocol tests (`plugins` and the relaunch), `src/main/db/migrations.test.ts`, and `tests/e2e/extensions.spec.ts`.
