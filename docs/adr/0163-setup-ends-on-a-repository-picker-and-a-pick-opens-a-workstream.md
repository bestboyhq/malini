# 0163 - Setup ends on a repository picker, and a pick opens a workstream

Status: superseded by 0242

## Context

0159 ended setup in a bare chat at Home: a composer asking "What are you working on?", five GitHub repositories hanging under it, and a pick that cloned while you stayed in the chat.
The user: "our onboarding screen sucks. We currently have some input, we have a list of repositories and it's confusing as shit."
A composer and a list on one screen asked two things at once, and a pick changed nothing you could see but a disabled row and the sidebar coming back.
They asked for "no input", and "whenever someone clicks a repo, we should just prepare the repo, start a work stream and navigate user to that work stream."
The three setup steps, ⌘K's command center and **Find a repository** from 0159 stay as they are.

## Decision

- Setup creates no chat: `finishOnboardingCommand` only marks setup finished, and `RepositoriesPage` shows `FirstRepositoryPicker` in place of its empty state while Malini has no repositories.
  A `picking` flag keeps the picker up until the route changes, so the first connected repository does not swap it for the list before its workstream opens.
- `FirstRepositoryPicker` is the heading "What are we working on?" over one card: the first five rows `repositories.list-github-repositories` returns, then **More repositories ⌘K**, **Open a folder ⌘O** and **New repository**.
  Signed out of GitHub, `GitHubSetup` sits above a card holding only **Open a folder**.
- Every way in starts a workstream: `RepositoryConnectOptions.open` is `'repository'` or `'workstream'`, and with `'workstream'` `connectRepositoryCommand` runs `createWorkstreamForRepositoryCommand` instead of `prepareRepositoryCommand`, so the workstream's own setup clones the repository, once, and opens it while it shows "Setting up".
  The picker's rows pass it to `pickGithubRepositoryCommand`, **Open a folder** to `openRepositoryFolderCommand`, and `CommandCenterDialog` passes it to every pick, URL and new repository while `onboardingQuery.data.shown` is `'picker'`; ⌘O and the menus' **Open Folder…** reach the same answer through `answerRepositoryFolderRequestCommand`.
  A row whose repository is cloning is disabled.
- `onboardingStore.shown` is `'setup'`, `'picker'` or `null`: `'setup'` keeps ⌘K closed, and either hides the sidebar and the top bar's history.
- The first-chat machinery is deleted: `ChatSurface`'s `welcome` snippet, `FirstChatRepositories`, `first-chat.ts`, `first-chat-tray.ts`, `leaveFirstChatCommand` and `malini.app.first-chat:v1` in `localStorage`.

## Consequences

- A new user lands in a workstream of the repository they picked with one click, and the sidebar comes back with it.
- A fresh install has no Home chat and no workstream until the first pick; the Home lead's setup line in `lineageInstructions` stays for a Home chat started later with no repositories.
- With no repositories, Malini has no empty Repositories page: **Find a repository** and **Open a folder** there open a repository's scratchpad only once one is connected.
- The picker shows the five repositories pushed to last and nothing else, since a pick now leaves the screen and nothing moves up into them.
- A first pick opens a workstream before its clone saves it, so quitting mid-clone leaves Malini's last route on a workstream that never existed; `leaveMissingWorkstreamCommand` sends `WorkstreamLayout` back to Repositories once a refresh confirms the workstream is gone.
- Enforced by `tests/e2e/first-run.spec.ts` (the picker with no chat and no composer across a reload, **More repositories** opening Find, a pick opening that repository's workstream and staying there after a reload, and **New repository** starting a workstream), `tests/e2e/open-folder.spec.ts` (the first folder starts a workstream, a later one opens its scratchpad), and the `passSetup` walk in `tests/e2e/harness.ts`, which waits for the picker.
