# 0275 - A lost clone comes back, and every checkout finding has one fix Malini runs

Status: accepted

## Context

0271 named a finding for each broken checkout, and 0273 made Malini repair six of them unasked.
The rest only told the user what to do: "Put the repository folder back, or archive this workstream", Terminal commands for a folder git does not trust, and "Prompts wait until the checkout works again" in the composer.
The user saw "The repository behind this checkout is gone" and asked what it means, called the screen "not actionable", and asked to "be unreasonably ambitious" about errors, "because most people will not debug it they will just leave and never come back".
That finding means Malini's own clone in `<checkouts root>/repositories/<owner>__<name>/base` is gone, not the repository on GitHub, and `connected_repositories` still holds its remote URL for 25 of the user's 26 repositories.
`repairCheckout` stopped as soon as that clone was missing, so the most likely case, a user who deleted `~/malini/repositories` to free space, was a dead end.

## Decision

- **A lost clone is cloned again.** `base-repository-missing` joins the findings `CheckoutHealthGuard` repairs unasked.
  `repairCheckout` in `checkout-doctor.ts` calls `CheckoutCase.reclone`, which `register.ts` builds from `createRepository`'s own clone: the remote URL, the seed folder, the credentials and the clone progress event, under the project lock, so several workstreams of one repository share one clone.
  It then links the folder back and keeps its files: a branch that is on the origin comes back from `refs/remotes/origin/<branch>` and reports `restored: 'branch-from-github'`, and any other branch starts again from the base start and reports `'commits-as-edits'`, or `'nothing-lost'` when `git status` then shows no change.
  `CheckoutHealth` gains `restored`, and the setup steps show it as a done step, **Cloned <owner/name> again**.
- **A failed clone names its cause.** The doctor keeps the last clone failure per origin in memory until a clone works: an auth failure is `github-signed-out`, a missing repository `remote-missing`, no room `disk-full`, and anything else stays `base-repository-missing`.
  A full disk counts as freed once 1 GB more is free than at the failure.
  A missing checkouts root is `checkouts-folder-missing`, and Malini makes it again only on **Make it again**, since the user may have moved it.
  The launch move refuses another disk (`otherDisk` in `checkouts-home.ts`), so that root sits on the Mac's own disk and is moved or deleted, never unplugged, and **Choose folder** would only schedule a move from a folder that is gone.
- **Every finding has one button that does the fix.** `checkout-finding-copy.ts` gives each finding a busy line, a broken line, one action, at most one second action and the composer's waiting line.
  `RETRIED_ON_REQUEST` findings run the repair again on **Sign in to GitHub** or **Use another account**, after the device-code sign-in in the step, and on **Make it again**, which makes the root first.
  `FIXED_ON_REQUEST` findings run `fixCheckout` in `checkout-fixes.ts`, which holds the checkout `repairing` until the doctor stops naming the finding: `git config --global --add safe.directory` for `dubious-ownership`, `xcode-select --install` for missing tools, `xcodebuild -license accept` through `osascript` with administrator privileges for the new `xcode-license`, and the Full Disk Access or Storage pane of System Settings for `permission-denied` and `disk-full`.
  `unknown` carries git's last `fatal:` or `error:` line as `said`, and **Ask an agent** starts an agent-mode chat in the workstream folder with `askAgentToFixCheckoutCommand`, which passes the readiness gate for that one prompt; when its turn ends Malini probes again.
  **Report** opens the problem report with the finding and git's line filled in, as a fact the user can switch off.
- **A fix that uncovers a repairable break repairs it.** A probe that finds a repairable finding after a finding Malini could not repair runs that repair at once, so a folder moved back or a freed disk goes on to clone or relink with no second click.
  A repair that ends healthy probes every other broken checkout, so one **Make it again** brings back every workstream.
- **The words say what waits.** The top bar says **Needs you** with the step's label and the step's button, or **Setting up** with the busy line and the clone percent; the composer says the copy's waiting line, such as "Sends once you sign in to GitHub".
  **Checkout broken**, **No usable checkout** and "Prompts wait until the checkout works again" are gone.

## Consequences

- A user who deletes Malini's clones gets every workstream back with no click, and a branch that was only on this Mac comes back as edits, never lost files.
- A checkout whose folder and clone are both gone loses its uncommitted work, since the checkpoints lived in the clone.
- A repository with no stored origin, such as the lead space, cannot be cloned again, and its step offers **Try again** that cannot work.
- `fixCheckout` changes the user's global git config only on **Trust this folder**, and the Xcode license only after macOS asks for the password.
- `git` lines in `said` stay on the Mac unless the user files a report with them: usage data still sends only the finding (0271).
- `checkout-doctor.test.ts` fails when a lost clone does not come back from a bare origin, when a pushed branch does not come back from it, when two workstreams clone twice, when a missing checkouts root is named wrong or does not come back from its origin, or when a 401, 404, 500 or full disk is misnamed.
- `checkout-health.test.ts` fails when a lost clone does not repair itself or when a break a fix uncovers waits for a click.
- `checkout-fixes.test.ts` fails when trusting a folder adds it twice or a cancelled password prompt is logged.
- `tests/e2e/checkout-base-reclone.spec.ts`, `checkout-health.spec.ts` and `checkout-agent-fix.spec.ts` fail when a deleted clone does not come back with **Cloned … again**, when a failed clone loses its **Try again**, or when **Ask an agent** and **Report** stop working.
