# 0274 - An archived checkout that comes back is cleared by the archive's rules

Status: accepted

## Context

ADR 0082 promised that an archived workstream's folder stays gone, but on the user's Mac six archived workstreams still had folders under `~/malini/workstreams/`, 1.0 GB together.
None was a worktree any more, and every file in them was written after the archive by something that still held the old absolute path.
Three held `.wrangler/cache/cf.json` from a `wrangler dev`, one the `.context` profile of an Electron app, and two 250 MB and 785 MB of ClickHouse logs from `docker run` containers whose bind mounts pointed into the checkout.
ADR 0082 only stops such a container, so a later `docker start` creates its mount folders again and it writes into them.
One of them mounted the checkout through `~/Library/Application Support/malini/workstreams`, the link the move to `~/malini` left (ADR 0171), and ADR 0082's matcher compares paths as text, so it never saw that container as the workstream's.
Teardown never looked at the checkout path after it moved the checkout to the trash, so nothing ever cleared a folder that came back.

## Decision

- At the end of every teardown, and in every start's `sweepArchivedLeftovers` for each archived workstream, saved for later included, `clearCheckoutThatCameBack` (`teardown.service.ts`) clears the workstream's checkout path when a folder sits there.
- `clearLeftoverCheckout` (`kept-folders.ts`) applies the archive's own rules to that folder and leaves alone a folder that holds `.git`, because that is a checkout again.
  - `.context` and `.malini/agent-attachments` merge into `.kept/<id>`; an archive then prunes them with `slimKeptContext` unless it is saved for later, and a delete drops them as it drops the rest of `.kept/<id>`.
  - The rebuilt folders and app bundles that ADR 0098 drops from `.kept` are removed.
  - A file goes when the saved commit ignores it or holds it byte for byte, which `filesSavedOrIgnored` (`src/main/git/archived-work.ts`) decides from the first of the archived ref, `origin/<base>` and `<base>` that exists.
    It writes that commit's `.gitignore` files into a temporary folder and runs `git check-ignore --no-index` there, and it compares `git hash-object --no-filters` with the commit's blob.
  - Every other file stays, and so does a nested folder that holds `.git`; Malini logs how many paths it kept.
  - Empty folders go, and the checkout folder with them once nothing stays.
- A delete clears only in its own teardown: it removes the workstream's row, so no later start knows which repository and base the folder came from.
- The leftover matcher of ADR 0082 also knows the workstreams root by its aliases: `workstreamsRootAliases` (`checkouts-home.ts`) lists its real path and the `workstreams` link in the app data folder or `~/malini` that resolves to it.
  `WorkstreamRunningMonitor` adds each workstream folder under every alias with `withAliases` (`running-docker.ts`) before it matches processes and containers, both to stop leftovers and to list what runs.
- A failure logs and leaves the folder for the next start.

## Consequences

- A folder that comes back at an archived checkout path costs disk only until the next teardown or start.
- On the user's Mac the next start removes all six folders, the ClickHouse logs, the `cf.json` files and the empty mount folders, and moves the Electron app's `.context` to `.kept`, where the prune drops its binary files.
- A file nothing saved survives, so a file someone writes into an archived path by hand stays until they remove it.
- A container that mounts a checkout through the old link is stopped at archive and at start like one that mounts it directly.
- A stopped container that mounts an archived path still exists and can write there again after `docker start`; the next start clears it again.
- A folder that comes back for a deleted workstream after its teardown stays until the user removes it.
- Ignored files count as rebuilt output, so an ignored file that held real work is lost the same way an archive loses it.
- Only the links Malini makes from its two default homes are known, as the `ponytail:` note in `checkouts-home.ts` says; a move between two chosen folders leaves the older link unknown.
- Enforced by the `what something writes into an archived checkout once it is gone` tests in `teardown.service.test.ts`, on real git and real SQLite, which keep an untracked unsaved file and a nested repository and cover a delete, and by the old-link test in `lib/stats/platform/leftovers.test.ts`, on a real symlink.
