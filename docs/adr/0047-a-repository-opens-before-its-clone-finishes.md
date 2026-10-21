# 0047 - A repository opens before its clone finishes

Status: accepted

## Context

0041 had `connectRepositoryCommand` record the repository's project, which clones Malini's private copy with `repositories.create-repository`, before it opened `/repositories/:repositoryId`.
Opening a folder whose origin is on GitHub clones from GitHub, so the user waited seconds, or minutes for a large repository, on a greyed-out button, and got confused.
The scratchpad (0019) needs only the connected repository row, which `repositories.connect` writes in milliseconds from local git reads.
Only workstreams need the clone, and provisioning already clones a repository that has no project yet, behind the per-project clone lock in `clone.service.ts`, so a workstream started mid-clone waits for that clone instead of starting a second one.
The user asked: "why wouldn't we just take someone to the repo's scratchpad right away?"

## Decision

- `connectRepositoryCommand` connects the repository, starts `prepareRepositoryCommand(repo)`, refreshes the list and opens `/repositories/:repositoryId`; the button that started it shows a spinner and "Opening…" or "Cloning…" only until then.
- `prepareRepositoryCommand` (`src/lib/shared/repositories/application/commands/prepare-repository.command.ts`) records the project in the background, then refreshes repositories and workstreams and runs `syncOwnPullRequestsCommand`, so 0041's pull request workstreams arrive once the clone is done.
- A failed clone keeps the repository: `repositoryPreparationQuery` reports it as failed until a project exists for it, and `RepositoryPage` shows "Could not clone this repository" with **Retry** and the remove button.
  The rollback that disconnected a newly connected repository is gone, and with it `repositories.disconnect`, the aggregate's hide-while-connecting set and `reveal`.
- Removal waits while a repository clones: `removeRepositoryCommand` returns early, `RemoveRepositoryButton` says why in its tooltip, and the sidebar menu reads "Remove after the clone finishes".
  A clone that finished after its repository was removed would write a project, and `mergeRepositories` would list the repository again.
- Provisioning passes the repository's default branch to `repositories.create-repository`, so the project row keeps the real default branch whichever clone writes it.

## Consequences

- Opening a folder or cloning a URL lands on the scratchpad in about a tenth of a second, whatever the repository's size.
- A clone error shows on the repository's own page, after the user has already arrived, instead of on the Repositories page with nothing connected.
- A clone in flight is renderer state: a reload mid-clone forgets it, and the next workstream clones lazily through provisioning.
- Removing a repository whose clone hangs waits for git to give up, as connecting did before.
- Enforced by `tests/e2e/open-folder.spec.ts` (the scratchpad opens and the clone lands in the background; a failed clone shows the banner and **Retry** recovers it; removal waits for a clone held open by a silent git server), `tests/e2e/clone-repository.spec.ts` (own pull requests still arrive after a clone) and the failure copy in `repository-connection.test.ts`.
