# 0146 - Extensions live in Settings, and publishing lives in Profile

Status: accepted

## Context

0142 gave extensions their own page: a sidebar footer button opened `/extensions`, which swapped the sidebar for Discover, Installed and Published, and each extension had a page of its own.
Published had its own **Sign in** to Bestboy and its own handle claim, beside the same sign-in in Settings, Profile.
Malini lists maybe a handful of extensions, and an extension only adds MCP servers and skills, which Settings already lists under MCP servers and Skills.
The person called that view terrible: "Discover/installed/published is so horribly complex", with "a ton of implementation leaks" such as `malini.json`, `skills/<name>/SKILL.md`, "Live 1.0.0" and "Reaches".
They picked variant B of three prototypes: Extensions as a Settings section beside Skills and MCP servers, the same one-way-in rule that left Jobs reachable only from the Job center.

## Decision

- Settings, **Extensions** (`EXTENSION_SETTINGS_HREF`, `/settings/extensions`) sits after MCP servers and renders `ExtensionsSettings` from `src/lib/extensions/presentation/`.
  It is one list: **Installed**, each with a switch, then **From the marketplace**, each with **Install**, and one filter over both.
- `ExtensionItem` opens an extension in place: its README, chips for its servers and skills, "Connects to" its hosts or "Skills only, it connects nowhere", its publisher, its repository, and **Uninstall** when installed.
  An update that connects to a new host shows that host under the extension with **Allow**.
- Settings, Profile gets **Extensions you publish** (`PublishExtensionsSettings`), signed in through Profile's own Bestboy sign-in; the `extensions.sign-in` command is gone.
- `Marketplace.publishing()` in `src/lib/extensions/platform/marketplace.ts` reads the index only when a repository has a `malini.json`, so Profile asks bestboy.dev nothing for someone who publishes nothing.
- Gone: the `/extensions` route, `ExtensionsSidebar`, the extension page, the footer **Extensions** button, and the search store behind them.
- Still true from 0144: the index and an extension's page are read with `cache: 'no-cache'`, at start and every hour while anything is installed, and a withdrawn version turns off.
- Still true from 0142: the marketplace API and its packages, installs into Malini's own folder handed to every session as SDK plugins, publishing what is committed under your handle, and the fourth outbound call, now read without a token only while Settings, Extensions or Profile is open or something is installed.

## Consequences

- Extensions has one way in, beside the MCP servers and skills it adds, and one Bestboy sign-in serves stats and publishing.
- An extension's details no longer have a URL of their own, so nothing links to one extension.
- Profile's description and page now cover publishing, so Profile is where everything that goes up to bestboy.dev under your name lives.
- Enforced by `tests/e2e/extensions.spec.ts`, which installs, turns off and uninstalls from Settings, Extensions, publishes from Settings, Profile after its sign-in, and checks the footer button is gone, and by the test in `src/lib/extensions/platform/marketplace.test.ts` that asks bestboy.dev nothing while no repository has a `malini.json`.
