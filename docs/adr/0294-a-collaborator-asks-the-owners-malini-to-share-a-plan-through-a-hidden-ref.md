# 0294 - A collaborator asks the owner's Malini to share a plan through a hidden ref

Status: accepted

## Context

0293 lets only the owner make the plan repository of a repository in another person's account, and turning sharing on there failed with "Only <owner> can make the private <name>-malini-plan".
Simon kept that rule but did not want the collaborator to carry the message: "I don't even wanna tell them I wanna make their Malini show it to them so it's like effortless and we don't even need to communicate to get that to happen".
Malini has no server, so the ask must travel through something both people already reach: the code repository, where a collaborator can push.
He picked a toast on the owner's side over a row in the Plan widget, "because it's not guaranteed that they will have this widget", and asked that Share there pin the widget too: "when they click share in the toast, they should get the plan widget added automatically as well".

## Decision

- When `PlanSyncService.turnOn` cannot see, join or make the plan repository, `#askAdmin` pushes an empty-tree commit, `Share the plan`, to `refs/malini/plan-requests/<login>` in the code repository, from `askToShare` in `initiatives/platform/plan-git.ts`.
  The ref carries only who asked, never the plan.
  `initiative_syncs.waiting_for` then holds the owner, the switch stays on and reads "Asked <owner>", and a failed push falls back to 0293's `no-plan-repository` error.
- The owner's Malini lists those refs with `git ls-remote` in `shareRequests`, for every non-hidden GitHub repository in the catalog whose sharing is off, at launch, every 10 minutes, and on each `initiatives.share-requests` call, which the renderer makes once per window load.
  Only an account with admin access to the code repository keeps what it finds, in `initiative_share_requests`, and its own login is skipped.
  A new asker emits `initiatives:share-requested`.
- The renderer shows that ask as a toast that stays, "<login> wants to share a plan. Only collaborators of <repository> see it", with **Share** and **Not now**, from `watch-share-requests.hook.ts`.
  Share turns sharing on as a click on the switch does, then calls `widgets.pin-plan`, which puts the Plan first on that repository's board at full width and two rows tall, or does nothing when the board already has it.
  Not now calls `initiatives.dismiss-share-request`, which sets `dismissed_at`, so the toast does not come back for those people; the dot beside the switch stays until sharing turns on.
- Once the owner's Malini manages the plan repository's access, every access check also deletes the request refs with `clearShareRequests` and forgets them in the database.
- While `waiting_for` is set, each sync of the asker's Malini looks for a pending GitHub invitation to that exact plan repository with `GET user/repository_invitations` and accepts only that one with `PATCH user/repository_invitations/{id}`.
  The first sync that reads the plan repository clears `waiting_for` and emits `initiatives:share-accepted`, which shows "<owner> said yes. The plan of <repository> is shared".
- Turning the switch off while waiting deletes the asker's own ref, so the owner's next scan finds no ask.
- An organization member who cannot make repositories there gets the same ask, and an admin of the code repository answers it.

## Consequences

- The code repository now gets one ref per asker from Malini, outside `refs/heads` and `refs/tags`, so no clone, branch list or pull request shows it; 0293's "never gets a file, milestone or issue" still holds.
- A collaborator can ask without a word to the owner, and an owner who never runs Malini sees nothing; the ask waits until they do.
- Every invitation a collaborator gets to a plan repository is accepted by their Malini only while it waits for that repository, so no other invitation is ever accepted for them.
- An owner with many repositories pays one `ls-remote` each per scan.
- Enforced by `src/lib/initiatives/platform/plan-sync.test.ts`, two Malinis on one real bare git remote with a per-login fake `gh` (the ask ref lands, the owner sees it once, Not now holds, Share invites the asker and clears the ref, the asker accepts and is told, turning off takes the ask back, an organization member who gets a 403 asks), `src/lib/widgets/platform/register.test.ts` (the Plan is pinned first, once), `src/main/db/migrations.test.ts`, and `tests/e2e/initiatives.spec.ts`, where the built app shows the toast for a seeded ask, and Share pins the Plan, invites the asker and clears the ref.
