# 0209 - A cut checkouts move finishes at the next launch

Status: accepted

## Context

0171 moves checkouts at launch, renaming `repositories/`, `workstreams/` and `projects/` into the new folder, and it says a failed rename puts back what it moved and records `checkouts.move-failure`.
It does not say what a launch finds when Malini quit between two renames, or when a move that quit halfway fails again on its next launch.
Both happen to a user who holds tens of gigabytes: a quit or a crash cuts the move, and the next launch meets a destination that already holds some of the checkouts.
`chooseCheckoutsFolder` takes only an empty folder, and the check at launch ran again on the folder you chose, so it refused that destination as `not-empty` for good, and the checkouts stayed split between two folders with no way to finish the move.
A second failure was worse: its rollback deleted the chosen folder, but the checkouts that earlier launches had moved stayed in the new folder with no link in the old one, while the database still named the old paths.
This record adds to 0171; the rest of 0171 stands.

## Decision

- **A move is marked started before its first rename.**
  `moveCheckoutsHome` in `apps/malini/src/lib/shared/repositories/platform/checkouts-home.ts` writes the destination as `checkouts.folder` with `started: true` once its checks pass, for the move to `~/malini` as for a folder you chose.
  A move that finishes deletes the setting, as 0171 says.
- **A launch that finds the mark does only the disk check.**
  The destination holds checkouts by then, so `not-empty`, `inside-checkouts` and `not-writable` no longer apply; `other-disk` still does, since a rename cannot cross disks.
  A launch that finds no mark keeps every check of 0171.
- **A resumed move that fails again links what earlier launches moved and stays started.**
  Its rollback puts back only the renames of that launch, then `linkMovedFolders` links each old folder that is gone to the folder it moved to, and the setting keeps `started: true`, so the next launch finishes the move.
  Settings shows the failure as 0171 says.
  **Cancel move** and **Change…** drop the setting and the mark.
- **A move that fails on its first launch fails as 0171 says.**
  It renames back what it moved, drops the choice and records the failure, and a move to `~/malini` tries again at the next launch.

## Consequences

- A move that a quit, a crash or a failed rename cut finishes at the next launch, with no step from you.
- An old folder holds a link as soon as it holds nothing, so a path in a transcript, terminal or script still opens after a failed attempt.
- A move started in one folder and then cancelled leaves the checkouts split between the old folder and the new one, joined by links.
  A later move to a third folder skips a link, since `moveFolder` moves folders and not symlinks, but it still rewrites the recorded paths, so the bases that stayed in the first target go missing from their workstreams until you move them back by hand.
  The data stays on disk; this is open.
- What must stay true: the mark is written before the first rename, a launch that finds it runs no check but the disk, and a failed resume never deletes it.
- Enforced by `checkouts-home.test.ts` on real git, SQLite and folders: "finishes a move that a quit cut short after it renamed the folders" and "links what a cut move already moved when it fails again, and finishes it later".
