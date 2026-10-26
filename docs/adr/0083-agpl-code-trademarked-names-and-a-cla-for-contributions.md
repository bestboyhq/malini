# 0083 - AGPL code, trademarked names, and a CLA for contributions

Status: accepted

## Context

Malini is AGPL-3.0-only, and Szymon Grącki, a private person, holds the copyright.
He wants to reuse Malini's code in a closed hosted platform and keep the option to relicense, which the AGPL alone does not allow for code other people contribute.
The license also says nothing about the Malini and Best Boy names and logos, so a modified fork could ship under them.
The copyright line differed across the README, electron-builder, the site footer (`© Bestboy`) and `packages/extension-api/LICENSE`, and the About panel showed Electron's name and no notices, so the app had no AGPL "Appropriate Legal Notices".

## Decision

`LICENSE` stays the verbatim AGPL-3.0 text.
Every place that names Malini's copyright holder says `Copyright (C) 2026 Szymon Grącki and Malini contributors`: `README.md`, `apps/malini/electron-builder.yml`, the About panel, the site footer, `NOTICE` and `packages/extension-api/LICENSE`.
`TRADEMARKS.md` keeps the names and logos out of the license, as the README's additional term under AGPL section 7(e) states.
`CLA.md` is an Apache-ICLA-style agreement that grants the maintainer, and any successor, a license to use contributions under any terms, including proprietary ones.
`.github/workflows/cla.yml` runs `iainmcgin/cla-github-action`, a Node 24 fork of the archived CLA Assistant Lite, pinned by commit SHA, on `pull_request_target` and pull request comments; it never checks out pull request code, skips pull requests that `szymeo` opens, stores signatures in `signatures/cla.json` on a `cla-signatures` branch it creates on its first run, and allowlists `szymeo` and `*[bot]`.
`NOTICE` names every third-party component Malini ships with its license and copyright line, and `extraResources` ships it beside `LICENSE`.
The About panel, from `aboutPanel` in `apps/malini/src/lib/app/platform/menu.ts`, shows the name, version, copyright, AGPL notice, no-warranty statement, source link and credits.

## Consequences

The maintainer can relicense or reuse every signed contribution, and forks must rename.
A contributor signs once with a pull request comment, and a pull request from an unsigned author fails the `CLA` check until they do.
The signatures branch must stay unprotected, since the workflow commits to it with `GITHUB_TOKEN`.
Upstream CLA Assistant Lite was archived on Node 20, which GitHub removed from its runners on 2026-09-23; of its forks, `iainmcgin/cla-github-action` keeps the same inputs, runs on Node 24, tags releases and keeps a changelog, though its owner maintains it for their own use and offers no support.
The fork fails a pull request whose opener wrote none of its commits, and `malini-agent[bot]` writes every commit in the pull requests `szymeo` opens, so the workflow skips those; a skipped job still passes a required check.
The fork also asks every `Co-authored-by:` identity to sign.
It runs with a write token, so moving the pin to a newer commit means reading the fork's changelog and diff first.
`thirdPartyNotices` in `apps/malini/scripts/third-party-notices.mjs` fails `pnpm build` when a bundled npm package has no line in `NOTICE`, and its test in `third-party-notices.test.mjs` covers that check.
Nothing enforces the copyright line or `NOTICE` entries for components outside the npm bundles, such as Electron, the SDK, `gh`, sounds, icons and fonts.
