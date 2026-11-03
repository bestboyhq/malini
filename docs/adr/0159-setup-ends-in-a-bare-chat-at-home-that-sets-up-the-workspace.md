# 0159 - Setup ends in a bare chat at Home that sets up the workspace

Status: accepted

## Context

Setup had five steps: Connect Claude Code and GitHub, Meet your jobs, Hear your afternoon, Where did you hear about Malini, and Open your first repository.
On the jobs step the user said "I'm not sure if anyone will even read that", and the built-in jobs are already one `/` away in every composer, on the Jobs card beside every chat and on the Jobs page.
On the repository step they asked to "just take you to the home screen or something like that so you don't feel like you're in the onboarding still".
They picked a chat at Home with nothing but the composer, because "it's super simple and it has little things to fuck up", asking "what are you working on?", since "the first goal is to basically populate the sidebar" and "the moment someone sends a message, we can show the sidebar and then we can set up their whole working space for them".
A new user cares about none of the rest of a Home chat yet: the chat tabs, the suggestions, "No workstreams yet" and the Jobs card.
Under the composer, **Clone repo** and **Open folder** did "like a lot of bullshit": the user wanted "only one", to "just choose the repo you want to work on or create a new one", in a list 80% of the composer's width with names only.
A full list with its own search made the composer "nearly full screen", so they asked to "connect this list to the bottom of composer and at the end of the list put show more", opening "the spotlight command center", to "teach them a habit that they can just command K".
They turned down "Clone", "Add" and "Open" for that command and named it **Find a repository**: "As a user, I don't give a fuck if it's local or remote. I only want to work on some repository", and "they don't really care if something is on this mac or not".

## Decision

- `ONBOARDING_STEPS` in `src/lib/app/domain/onboarding.ts` is `accounts`, `sounds`, `heard-about`, and Continue or Skip on the last step finishes setup; `JobsIntro` and `OnboardingRepositoryStep` are deleted.
- `finishOnboardingCommand` picks the Home chat's id with `nextWorkstreamId`, provisions it with `startLeadChatCommand(HOME_SCOPE, { workstreamId, inBackground: true })`, opens it, and only then marks setup finished, so the setup card stays until the route changes.
- That id is the first chat, kept in `localStorage` under `malini.app.first-chat:v1` so a relaunch reads it before the first paint.
  `leaveFirstChatCommand` clears it once `firstChatBegan` in `src/lib/app/presentation/first-chat.ts`: a prompt is pending or the chat has a session.
- While `firstChatWaits`, `WorkstreamPage` drops the lead status and inspector and `WorkstreamLayout` the docked Jobs card.
  While `firstChatBare`, which is `firstChatWaits` with no repository connected, `WorkstreamsLayout` drops the sidebar and `TopBar` its history, so the first repository brings them back.
  `ChatSurface` gets a `welcome` snippet, rendered in the composer's own `chat-column`, that hides the chat tabs and suggestions and centers the composer with the placeholder "What are you working on?".
- `FirstChatRepositories` is that snippet, and the composer narrows to 640px while it shows: a tray inset under the composer of the five rows `firstChatTray` in `src/lib/app/domain/first-chat-tray.ts` takes from the 100 GitHub repositories `repositories.list-github-repositories` returns, newest push first, with a pick further down moved up into them.
  Each row is an avatar, `owner/name`, a lock when private, and its last push; under them **More repositories ⌘K**, then **New repository**, each a row of its own.
  A pick runs `pickGithubRepositoryCommand` with `open: false`, so the clone starts and you stay in the chat, and the row is disabled from then on; no row says whether a repository is on this Mac or being cloned.
- **⌘K** opens `CommandCenterDialog`, mounted once in `App.svelte`, anywhere but on the setup card, the same `onboardingQuery.data.shown` that hides the chrome, and `ChatTabs` no longer takes ⌘K for its overflow, which stays behind its **…** button.
  `commandCenterGroups` in `src/lib/app/domain/command-center.ts` drives its three modes: `commands` lists **Find a repository**, **New repository**, **Open a folder**, **New chat** in a workstream and **Settings**, with matching repositories under **Your repositories** once you type; `find` searches every repository; `new-repository` asks for a name, an owner and **Private**.
  `find` searches `findableRepositories`: your GitHub listing plus every connected repository it lacks, matched by `owner/name` without case, so a folder-only repository is found the same way, and Enter opens whichever you pick, cloning it first when Malini has no clone; from a first chat that waits, a pick clones and you stay in the chat, as a tray row does.
  A pasted git URL becomes one **Open** row, a search with no match becomes **New repository** with the name carried over, and Backspace in an empty field goes back to commands.
  **More repositories** opens it in `find`, and **New repository** in `new-repository`, and the same command is **Find Repository…** in the File menu and the menu bar icon, **Find repository…** in the sidebar's add menu, and **Find a repository** on the Repositories page.
  `createGithubRepositoryCommand` runs `repositories.create-github-repository`, which posts to `user/repos` or `orgs/<owner>/repos` with `auto_init=true`, since a workstream cannot branch from an empty repository, then clones the result.
  `repositories.list-github-owners` fills the owner list with the signed-in login and its organizations, and GitHub's own reason for a refusal, such as "Name already exists on this account", is what the error says.
  `CloneRepositoryDialog` is deleted, and the request that sent the menus to the Repositories page now only asks for a folder.
  On the first send the tray fades, the composer slides to the bottom and widens back to the transcript, and everything else comes back.
- `lineageInstructions` in `packages/agent-bridge/src/claude/instructions.ts` tells a Home lead, while Malini has no repositories, to set up the workspace first: work out the repositories from what the user says and `gh repo list`, add each with `repositories_clone`, one when one covers it, then carry on with what they asked.

## Consequences

- Setup is three steps, and a new user fills the sidebar with one click or with the first thing they type: the lead asks once to clone each repository, and it lands under its owner.
- One command finds a repository wherever it is, so nothing asks whether it is local or on GitHub; a repository only on this Mac that GitHub does not list shows no description or push time.
- ⌘K no longer finds a chat tab that does not fit; the command center should list them once it learns chats.
- A first chat left unsent keeps its list, even with repositories connected, until a prompt goes out.
- Creating a repository reaches GitHub through `gh api`, so it needs no new scope; deleting a test repository does, and stays manual.
- Jobs are no longer introduced; a new user meets them on `/` and the Jobs card once the first chat starts.
- The bare chat has no sidebar link to Settings; the app menu's **Settings…** and `⌘,` still open it.
- The first chat is a real lead workstream from the moment setup ends, so a listing of workstreams or repositories on a fresh install holds the Home chat and Malini's lead space.
- The flow needs a lead's own approvals to show in its timeline; `LeadTimeline` now syncs its session's interactions, which it never did, so every approval a lead asked for itself read "No longer active" and its turn waited forever.
- Enforced by `tests/e2e/first-run.spec.ts` (three steps, heard-about last, the bare chat with its tray across a reload, ⌘K ignored on the setup card and opening from the composer after a reload, **More repositories** opening Find, a pick that clones while the chat stays and stays disabled after a reload, the chrome back after a send and after a reload, and **New repository** under an organization with GitHub's refusal shown), `tests/e2e/command-center.spec.ts` (⌘K's commands, Find, a folder-only repository, a pasted URL and Open a folder), `tests/e2e/clone-repository.spec.ts`, `command-center.test.ts` and `first-chat-tray.test.ts`, `github.service.test.ts` (the owners, the create request and its refused names), `tests/e2e/lead-timeline.spec.ts` (a lead's own approval waits on its card and goes on once allowed), the `passSetup` walk every setup spec shares in `tests/e2e/harness.ts`, and `instructions.test.ts` (the setup line only for a Home lead with no repositories).
