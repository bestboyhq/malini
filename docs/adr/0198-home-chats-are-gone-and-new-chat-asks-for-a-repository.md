# 0198 - Home chats are gone, and New chat asks for a repository

Status: accepted

## Context

0070 put a chat above repositories in two places: Home, with every repository in reach, and an organization, with its owner's repositories.
Both are leads, workstreams of the lead space (`scope` is `home` or `owner:<owner>`), and the sidebar's global **New chat** started a Home chat.
The user called the global chats unused: "I use this app a lot and I have many use cases for that and I'm just not using them", and "you always have a context of something".
They proposed a plus button that asks for the scope when someone has none in mind, and a sidebar that adapts to "different work styles" (0197).
A flat sidebar, grouped by status, has no repository row to put a plus on, so the global **New chat** has to ask which repository.
They then said "existing home chats should get archived simply", and added "maybe we should also get rid of organization-wide chats".
The "maybe" is a question, so organization chats stay: the Logdash supervisor of 0070 is one, and nothing in the user's words says it has no use.

## Decision

- `LeadScope` is `{ kind: 'owner'; owner }` only (`src/lib/shared/repositories/domain/lead-scope.ts`).
  `parseLeadScope` returns null for `home`, so a Home chat reads as plain work in the lead space and never as a lead.
  `repositories.create-lead` accepts `owner:<owner>` and refuses `home`.
- The `scope` column keeps accepting `home` in its CHECK constraints.
  Rebuilding four tables to drop a value no row needs once the sweep ran costs more than it returns.
- At boot, once `registerModules` has registered every module, `archiveHomeChats` archives every workstream whose scope is `home`, through `archiveWorkstream`, so the checkout is torn down and the sidebar hears `repositories:workstream-removed` like for any archive.
  Teardown reaches the chat and stats modules, so the sweep cannot start inside `registerRepositories`.
  `restoreWorkstream` refuses an archived Home chat, and **Recently archived** leaves it out (`isRetiredHomeChat`).
  Brain capture still reads an archived Home chat once, under the place **Home** (0183).
- The sidebar's global **New chat** row opens the command center in a new `start` mode (`src/lib/app/domain/command-center.ts`), headed by a **New chat** chip, with the repositories you connected first and the rest of your GitHub repositories after.
  A pick connects the repository when needed and opens a new workstream in it, like a pick in setup's picker (0163).
  **Find a repository** keeps its own mode, which opens a repository's scratchpad.
- An organization chat starts from the plus on its owner row, or from **New chat in `<owner>`** when the sidebar focuses that owner.
  `AgentLead.owner` is a string, and the lead's bridge instructions name only the owner: bridge protocol 52.
- A schedule says where it runs: `every <cadence> at HH:MM in <owner>` or `in <owner>/<repository>`.
  The Automations commands refuse a schedule without a place, except for the brain's built-in automations, which always run in the brain (`isBrainAutomationBuiltin`).
  Drafts and the trigger picker default the place to the first connected owner (`defaultSchedulePlace`).
- A migration turns an automation whose schedule had no place into a manual one, with its trigger mode cleared, because Home was the only place a placeless schedule ran.
- The landing page's tour clicks the owner's plus instead of the global row, with the sidebar focused on that owner (`src/renderer/demo/main.ts`, 0120).

## Consequences

- Work above a repository needs an owner, and the sidebar always has a place for it.
  A user with repositories in two owners starts one chat in each, where a Home chat saw both.
- The global **New chat** is one extra step, a repository pick, but it ends in a workstream with a checkout, which a Home chat never had.
- Chats you had at Home are archived on the next launch and cannot come back.
  Their transcripts stay in the database and in the brain's log.
  A Home chat that has not been swept yet, between the app opening and `archiveHomeChats` finishing, lists as ordinary work for a moment.
- Automations scheduled at Home stop firing until someone picks a place for them.
- `workstreams.test.ts` runs the sweep and the restore refusal on real SQLite and git, `modules.test.ts` boots the whole module graph with a Home chat, the `automation-trigger` and `migrations` tests pin the schedule grammar and the migration, and `command-center.spec.ts` and `lead-chats.spec.ts` drive the picker and organization chats in the built app.
- Supersedes the Home half of 0070 and the Home parts of 0163 and 0197; the organization half of 0070 stands.
