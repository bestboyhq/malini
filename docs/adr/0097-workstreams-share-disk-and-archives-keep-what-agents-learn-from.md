# 0097 - Workstreams share disk, and archives keep what an agent can learn from

Status: accepted

## Context

The user wants as many workstreams and chats as they like without Malini taking over their disk, while an agent can still learn from any work they did.
On their Mac, `workstreams/.kept` held 17.2 GiB for 218 archived workstreams: 6.5 GiB of screenshots, 3.5 GiB of other binaries, 2.9 GiB of dependency and git folders, 2.0 GiB of audio, 1.3 GiB of app bundles and 0.8 GiB of video, beside 258 MiB of text and 225 MiB of copies chats showed.
25 live workstreams held 9.5 GiB by `du`, 8.4 GiB of it `node_modules`, because every `git worktree add` wrote a full checkout and every workstream ran its own install (0006).
A folder with a remote was cloned again from that remote, since `repositoryCloneSource` prefers `remoteUrl`, so its history sat on disk twice, and nothing checked for free space.
Node's `copyFile` with `COPYFILE_FICLONE` makes a full copy on macOS and `COPYFILE_FICLONE_FORCE` fails with `ENOSYS`, so 0071's kept copies were never clones, while `/bin/cp -c` clones: four copies of a 512 MB file took 2 GB through Node and nothing through `cp -c`.
`statfs` leaves out purgeable space: it reported 263 GB free where Foundation reports 356 GB usable for important work on the same volume.

## Decision

- Checkouts are copy-on-write: `addWorktree` and `restoreArchivedWork` run `git worktree add --no-checkout`, then `populateCheckout` (`src/main/git/worktrees.ts`).
  It clones the base checkout's tracked top-level entries, gitlinks aside, with `cp -c -R`, runs `git read-tree HEAD`, drops what the base held untracked or ignored with `git clean -ffdxq`, empties a submodule folder that came with its `.git`, hashes the clones with `git update-index -q --refresh`, and lets `git reset -q --hard HEAD` write only the files that differ.
  It refuses a folder whose `.git` is not a file, so it never cleans a main checkout.
- Every clone goes through `/bin/cp -c` (`src/main/fs/copy-on-write.ts`), which copies plainly off APFS; `keepShownFile` uses it too.
- With npm or yarn, `sharedNodeModules` (`provisioning.service.ts`) copies the `node_modules` beside every tracked `package.json` with `cp -c -R` from a live workstream of the same repository whose install marker matches both its own lockfile and the new checkout's, drops `.cache` and `.vite`, and records the install as done; otherwise the install runs as before.
  pnpm and bun already clone from their stores.
- `repositories.create-repository` finds the connected folder whose clone source is the URL (`cloneSeedFolder`).
  A folder that is not shallow, partial or borrowing objects through alternates is cloned with `git clone --local --no-checkout` from its git directory; its hardlinked packs get `.keep` files so a repack never rewrites them, `origin` becomes the remote, `git fetch --prune --prune-tags origin` replaces the folder's branches and tags with the remote's, and the default branch is checked out from `origin`.
  Any failure there falls back to cloning from the remote.
- Without a folder, a GitHub repository whose `diskUsage` (`gh repo view --json diskUsage`) is 1 GB or more clones with `--filter=blob:none`, and the clone keeps `credential.https://github.com.helper`, reset and then `!gh auth git-credential`, so a blob fetched later by Malini or an agent signs in the way Malini's own fetches do.
- Archiving prunes `.kept/<id>/.context` (`pruneKeptContext` in `kept-folders.ts`): it keeps text files, with no NUL byte in their first 8 KB, up to 10 MB, and drops dependency, git and cache folders such as `node_modules`, `.git` and `.venv`, app bundles, and every other file.
  The copies chats showed under `shown/` and the agent attachments stay whole, and saving for later keeps all of `.context` until the workstream moves to the archive.
  A `.pruned` mark lets the startup sweep (`sweepArchivedLeftovers`) prune each workstream archived before this once.
- `requireFreeSpace` (`src/main/fs/free-space.ts`) refuses to start, clone or restore a workstream with less than 2 GB free, plus GitHub's size for a full clone, and says how much is free.
  It reads `statfs`, and only when that is low asks Foundation for `NSURLVolumeAvailableCapacityForImportantUsageKey` through `osascript -l JavaScript`, so purgeable space counts.

## Consequences

- A workstream costs the files its agent changes, and only the first workstream per npm or yarn lockfile installs; in the native check a second `malini` workstream took 9 MB of disk and a second `grip` workstream 11 MB beside its sibling's 241 MB `node_modules`.
- A dry run of the prune on the user's `.kept`, by then 17.5 GiB, keeps 0.4 GiB: the text notes, the copies chats showed and the attachments.
- Filling a checkout reads every file once to hash it, as a checkout writes every file once, and files that changed since the base checkout's commit are written fresh, as the `ponytail:` note in `worktrees.ts` says.
- An archive keeps what an agent learns from: chats, commits, uncommitted work, attachments, every image or recording a chat showed, and the text notes; a restore brings back that slimmer `.context`.
- A blobless clone needs the network and a `gh` sign-in the first time something reads an old version of a file, so offline `git log -p` fails there; only repositories GitHub reports at 1 GB or more take that trade.
- Kept packs stay shared with the folder for good, and a pack the folder repacks away lives on in Malini's clone.
- A shared `node_modules` holds whatever its source workstream installed, which is why both markers must match their lockfiles.
- Enforced by `src/main/git/worktrees.test.ts` (clones keep their mtime, dirty and ignored base files stay out, submodules come empty, a main checkout is refused), `clone.service.test.ts` (the folder clone ends where the remote is with kept packs, a shallow folder falls back, the blobless config), `workstreams.test.ts` (a restore brings back the notes, saving for later keeps everything, the startup prune), `provisioning.service.test.ts` (shared `node_modules`, another lockfile installs, pnpm never copies) and `src/main/fs/free-space.test.ts`.
