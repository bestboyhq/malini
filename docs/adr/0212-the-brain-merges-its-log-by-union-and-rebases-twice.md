# 0212 - The brain merges its log by union and rebases twice

Status: accepted

## Context

0184 lands the brain straight on `main`: when GitHub has commits this Mac lacks, Malini fetches `main`, rebases onto it once and pushes again, and a clash stops with `MAIN_DIVERGED`, which asks you to pull by hand.
Each capture appends its chats to the day's file, `log/<day>.md` (`src/lib/brain/platform/brain-capture.service.ts`), so two Macs that capture on the same day add lines at the same place, and git stopped the rebase on that although neither side removed a line.
`main` can also move again between that rebase and its push, when another Mac lands in those seconds, and the second rejection then showed `MAIN_DIVERGED` too, for a clash that did not exist.
Malini writes `log/` only by appending, and it puts back whatever the notes agent changes there (0184), so a log day that keeps every line of both sides loses nothing.
This record replaces 0184's **One rebase, then you**; the rest of 0184 stands.

## Decision

- **Logs merge by union.**
  Before every push to GitHub, `#push` in `src/lib/brain/platform/brain.service.ts` calls `mergeLogsByUnion` (`src/lib/brain/platform/brain-git.ts`).
  It adds the line `log/*.md merge=union` to `info/attributes` in the git common dir of the brain's clone (`git rev-parse --git-common-dir`), once, after whatever that file already holds.
  The Brain workstream's worktree shares that dir, nothing is committed to the repository, and the line outranks any `.gitattributes` the repository has.
  A rebase then merges a log day that both sides changed by keeping the lines of both, GitHub's first, with no conflict markers.
  `notes/`, `README.md` and every other path merge as before.
- **Two rebases, then you.**
  `pushHeadToGithubMain` (`src/main/git/remote.ts`) pushes at most `MAIN_PUSH_ROUNDS = 3` times.
  When GitHub rejects the first or the second push as `fetch first` or `non-fast-forward`, it fetches `main` and rebases onto it: up to three pushes and two rebases.
  Any other failure stops at once, as 0184 set it: a denied push waits for you, and a push that cannot reach GitHub waits quietly.
- **A clash still stops.**
  A rebase that fails is aborted, the brain's own commits stay, and the problem is `MAIN_DIVERGED`, 0184's copy.
- **A third rejection says what git said.**
  `pushHeadToGithubMain` throws that push's own failure, so the Brain page and Settings, Brain read "The remote branch has new commits. Update this branch and try again." (`gitFailureVerdict` in `src/main/errors.ts`), with **Retry**.
- A brain kept in a folder on this Mac lands through `pushToFolderOrigin`, which neither rebases nor merges by union, as before.

## Consequences

- Two Macs that capture on the same day both land without you, and the day's file holds both captures in the order they reached GitHub, not by time.
- The rule lives only in this Mac's clone, so a clone outside Malini still stops on a log day that two Macs changed.
- Only a clash outside `log/`, such as two Macs that rewrite the same note, still waits for you, and `main` must move three times during one landing before Malini gives up.
- A known rough edge: after the third rejected push the problem is git's generic verdict, which asks you to update a branch, and the brain has no branch for you to update.
  **Retry**, the next landing or the five-minute push clears it once a push goes through.
- What must stay true: captures only append to `log/`, and `mergeLogsByUnion` runs before every push to GitHub.
- Enforced by `src/lib/brain/platform/brain-git.test.ts` ("lands two Macs that captured the same day, keeping both captures", "stops on a clash, keeps its own commit and leaves no rebase behind", "rebases once over notes landed elsewhere, then pushes") and `src/main/git/remote.test.ts` ("rebases again over a push that lands between its clean rebase and its push").
  Nothing tests the third rejection; `src/main/errors.test.ts` ("says the remote branch moved on a %s rejection") checks only the copy it shows.
