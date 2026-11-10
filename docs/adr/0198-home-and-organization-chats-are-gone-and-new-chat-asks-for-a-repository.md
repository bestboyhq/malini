# 0198 - Home and organization chats are gone, and New chat asks for a repository

Status: accepted

## Context

0070 put a chat above repositories in two places: Home, with every repository in reach, and an organization, with its owner's repositories.
Both were leads, workstreams of the lead space, a local git repository recorded as the project `malini-lead-space`, and the sidebar's global **New chat** started a Home chat.
The user called the global chats unused: "I use this app a lot and I have many use cases for that and I'm just not using them", and "you always have a context of something".
They proposed a plus button that asks for the scope when someone has none in mind, and a sidebar that adapts to "different work styles" (0197).
A flat sidebar, grouped by status, has no repository row to put a plus on, so the global **New chat** has to ask which repository.
They then said "existing home chats should get archived simply", added "maybe we should also get rid of organization-wide chats", and asked for those to go too.
A lead carried more machinery than any other chat: its own space, decisions, a plan, a brief that restarted every turn, a timeline instead of the transcript, and a bridge profile that ran without file tools.
With both kinds gone, every chat is a workstream of one repository, with a checkout, a place in the sidebar and the same transcript.

## Decision

- A chat is a workstream of a repository.
  The lead space, `repositories.create-lead`, the plus on a sidebar owner row and **New chat in `<owner>`** are gone.
- The workstreams of the project `malini-lead-space` are retired chats (`RETIRED_CHATS_PROJECT_ID` and `isRetiredChat`, `src/lib/shared/repositories/domain/retired-chats.ts`).
  `localRepositoriesFromProjects` still drops that project, so it is never a repository.
- At boot, at the end of `registerModules`, `archiveRetiredChats` archives every active retired chat through `archiveWorkstream`, so the checkout is torn down and the sidebar hears `repositories:workstream-removed` like for any archive.
  Teardown reaches the chat and stats modules, so the sweep cannot start inside `registerRepositories`.
  `restoreWorkstream` refuses a retired chat, and **Recently archived** leaves it out.
  Brain capture still reads an archived retired chat once, and names its place from `workstreams.scope`: the owner, or Home (0183).
- The columns `workstreams.scope` and `automation_runs.scope` stay in the schema, and the rows keep their value.
  No code reads or writes them, except brain capture.
  Rebuilding tables to drop a column no row needs once the sweep ran costs more than it returns.
  `agent_deliveries.kind` keeps `'decision'` in its CHECK, and nothing writes it.
- The sidebar's global **New chat** row opens the command center in a `start` mode (`src/lib/app/domain/command-center.ts`), headed by a **New chat** chip, with the repositories you connected first and the rest of your GitHub repositories after.
  A pick connects the repository when needed and opens a new workstream in it, like a pick in setup's picker (0163).
  **Find a repository** keeps its own mode, which opens a repository's scratchpad.
- What only a lead used is deleted:
  - lead decisions: the tools `decisions_ask` and `decisions_answer`, the queue, viewer and list, the commands `chat.list-lead-decisions` and `chat.answer-lead-decision`, the event `chat:lead-decision-changed`, the `decision` delivery kind and the `lead_decisions` table;
  - the lead plan: `plan_write`, `.context/plan.md`, the plan in the lineage and `LEAD_PLAN_PATH`;
  - the lead brief and the fresh conversation per turn, `LeadTimeline` and `LeadTopBarStatus`;
  - the bridge's `lead` lineage and profile: `AgentLineage` is `{ startedBy, siblings }`, `AgentLead` is gone, and the bridge protocol is 53.
- A schedule says where it runs: `every <cadence> at HH:MM in <owner>/<repository>`.
  `in <owner>` alone no longer parses (`SchedulePlace` is `none` or a repository).
  The Automations commands refuse a schedule without a repository, except for the brain's built-in automations, which always run in the brain (`isBrainAutomationBuiltin`).
  Drafts and the trigger picker default the place to the first connected repository (`defaultSchedulePlace`).
- Migrations drop `lead_decisions` and the rows that point at it, and turn an automation into a manual one, with its trigger mode cleared, when its schedule names no repository or its trigger is the removed event.
  Before this, an owner or Home was where a placeless schedule ran.
- The starter mechanism stays: `startedBy`, the tools `workstreams_create`, `workstreams_list`, `workstreams_send` and `workstreams_archive`, the report every finished turn sends to the chat that started it (0110), **Started by** and siblings, the progress dots, **Draft all** and **Merge all**.
  A repository workstream starts work in other repositories the same way a lead did.
- The sidebar nests nothing.
  Only Home and organization chats held rows (0083, 0088), so with them gone no row holds another, and `nestStarted` and every nested row are deleted.
  `workstreamRoots` stays for the attention rollup of a started chain (0090) and for **Started by** and siblings.

## Consequences

- Work across repositories starts from a chat in one of them, which starts the others with `workstreams_create`.
  It no longer starts from a chat above all of them, and that chat read Malini's clones of the repositories in its scope, which a repository chat does not.
- The global **New chat** is one extra step, a repository pick, but it ends in a workstream with a checkout, which a lead never had.
- Chats you had at Home or in an organization are archived on the next launch and cannot come back.
  Their transcripts stay in the database and in the brain's log.
- Automations scheduled at Home or in an owner stop firing until someone picks a repository for them.
- A retired chat's data stays on disk: `scope`, its sessions and events.
  Only the code that read them is gone.
- The sweep runs after every module registered, so a retired chat is archived a moment after the window opens, not before it.
- `modules.test.ts` boots the whole module graph with retired chats and checks that the sweep archived them, `retired-chats.test.ts` pins which chats are retired, and `workstreams.test.ts` runs the sweep and the restore refusal on real SQLite and git.
- The `automation-trigger` and `migrations` tests pin the schedule grammar and the migrations, `command-center.spec.ts` drives the picker in the built app, and the bridge protocol check (`generate-protocol.mjs --check` and `protocol.test.ts`) fails when protocol 53 and the tool list drift.
- `pnpm check` fails when a removed command, event or contract type is still used, and when `contract-reference.generated.ts` or `reference/events.md` is stale.
- Supersedes 0070, 0073, 0083, 0088, 0108, 0112, 0113 and 0114, and the Home parts of 0163 and 0197.
  0110 stands, and so do the parts of 0075, 0076, 0089, 0090, 0132 and 0133 that are not about a lead.
