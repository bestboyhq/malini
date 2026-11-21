# 0276 - Every repository you open starts a workstream

Status: accepted

## Context

0052 landed a repository you opened on its page, the scratchpad then and the plan since 0268, and cloned it in the background.
0163 and 0242 made the first repository the exception: a pick on the picker starts a workstream and opens it.
So the same action had two answers, held in `RepositoryConnectOptions.open`, `'repository'` or `'workstream'`, and only the first repository got the chat.
Simon: "I think we should never put anyone into scratchpad or whatever. We should always eagerly create a work stream for them instead. Because it's really confusing for someone to land on a scratch pad in an application like this one. We should completely get rid of this behavior from our system."
This supersedes 0052 and amends 0242 and 0268.

## Decision

- `RepositoryConnectOptions` loses `open`.
  `connectRepositoryCommand` always runs `createWorkstreamForRepositoryCommand` once `repositories.connect` answers, so the workstream's own setup clones the repository and the route is the workstream while it shows "Setting up".
- `pickGithubRepositoryCommand` starts a workstream for a repository that is already connected too, so **Find a repository**, a pasted URL, **Open a folder**, **⌘O**, **New repository** and the picker all end in a workstream.
- The background clone of 0052 is deleted: `prepareRepositoryCommand`, `repositoryPreparationQuery`, `preparing` and `preparationFailures` in `repositoryConnectionStore`, `RepositoryPreparation`, the `failed` kind of `GithubRepositoryState`, and the **Could not clone this repository** banner on `RepositoryPage`.
  A clone that fails says so in the workstream's setup, with its retry, as the first pick always did.
- A repository's page stays, with its plan, scratchpad, saved workstreams and pull requests.
  Only a click on the repository's name, in the sidebar or the Repositories list, opens it.

## Consequences

- Opening a repository has one answer, and it is a chat you can type in.
- Picking a connected repository in **Find a repository** starts a new workstream in it; the sidebar is how you go back to one you have.
- A repository whose first clone failed has no banner on its page; the next workstream you start there clones it again.
- **Remove** no longer waits for a background clone, since none runs outside a workstream's setup.
- Enforced by `tests/e2e/open-folder.spec.ts` (the first folder and a later one both start a workstream), `tests/e2e/clone-repository.spec.ts` and `tests/e2e/command-center.spec.ts` (a pick, a folder and a pasted URL in the command center each open a workstream), and `tests/e2e/first-run.spec.ts`.
