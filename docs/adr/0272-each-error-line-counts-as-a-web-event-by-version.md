# 0272 - Each error line counts as a web event, by version

Status: accepted

## Context

0058 sends usage counts as web events and error lines to Logdash `/logs`.
Logdash insights read web events only, so no dashboard card could chart errors.
No `malini_desktop_*` event carried the app version, so a release that broke something could not be told from the one before it.
A release ships on merge (`docs/packaging.md`), so nothing stands between a bad merge and every Mac.
0266 keeps every account and install id off error lines.

## Decision

- For each error line it sends, `startUsageData` in `src/lib/app/platform/usage-data.ts` also sends the web event `malini_desktop_error` with three properties and no user id:
  - `fingerprint`, the same as the line's (0270);
  - `kind`, the error's kind, else its name, else `other` when it is not a short identifier; `process-gone` for a gone process, and the doctor's finding for a broken checkout (0271);
  - `version`, `context.appVersion`.
- A repeat line sends no event, so a storm counts once per launch.
- `malini_desktop_day` carries `version` too.
- The Malini view on bestboy.dev holds the card **Release health: error lines against active days**, a trend of `malini_desktop_error` against `malini_desktop_day` per day and per week, and the weekly checkout breaks by finding.
- A per-version read uses the `breakdown` tool with `prop.version:<version>`, since a saved card cannot group by a property.
- This reports a bad release and does not block one.
  A block needs staged updates, which Malini does not have.
- The daily triage automation that reads these lines and files issues is not part of this decision.

## Consequences

- Errors per active day per version can be read on the dashboard and with the Logdash tools.
- The event goes only while **Share usage stats** is on, like every count.
- A release that doubles its errors is visible within a day of its first active Macs, after it has shipped to them.
- `src/lib/app/platform/usage-data.test.ts` fails when the error event carries a user id or a property outside the three, or when `day` loses `version`.
