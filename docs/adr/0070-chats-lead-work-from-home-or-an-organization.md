# 0070 - Chats lead work from Home or an organization, as workstreams of Malini's lead space

Status: accepted

## Context

Every chat ran inside a workstream, a git worktree of one repository (0006), so work across repositories needed a chat in some repository to start the others with `workstreams_create` (0061, 0063, 0067).
The user ran a Logdash "supervisor" that way, inside the logdash.io repository, and the sidebar listed every SDK repository it touched.
They asked to work "on any resolution": one repository, an organization ("start a chat on just organization level"), or "a global resolution where they just have a chat", with workstreams that "know of each other" and a sidebar people adjust to how they work.
They also worried that the higher the level, the more the work depends on the model, so the leads stay thin: a lead never edits code, each decision it makes is a visible workstream with one repository and one prompt, and checks gate every merge.
A chat needs a workstream underneath: `agent_sessions.workstream_id` is NOT NULL, checkpoints, approvals, attachments and images key on a checkout, and the renderer's chat state keys on the route's workstream.

## Decision

- A chat above repositories, a lead, is a workstream of Malini's lead space: a local git repository at `<app data>/lead-space` with one empty commit, recorded as the project `malini-lead-space` (`LEAD_SPACE_PROJECT_ID`, `src/lib/shared/repositories/platform/lead-space.service.ts`).
  `repositories.create-lead { scope }` starts one, and the sidebar's **New chat** rows call it.
- Migration 63 adds `workstreams.scope`, `home` or `owner:<owner>` for a lead and NULL for repository work, and `workstreams.started_by`, the workstream whose chat started it (`ON DELETE SET NULL`).
  It fills `started_by` from every succeeded `workstreams_create` call in `agent_actions`, so supervisors that already started work get their children.
- `workstreams_create` records the calling chat's workstream as `startedBy` and sends the first prompt with `from`, which the started chat shows as **Prompt from**.
  `workstreams_list` returns `startedBy`, leaves leads out, and adds the caller's archived children with `merged`.
- Bridge protocol 40: `send_prompt` carries `lineage`, from `workstreamLineage` in `src/lib/shared/repositories/platform/lineage.service.ts`.
  A lead runs without `Edit`, `Write` and `NotebookEdit`, with instructions to plan and delegate, and with Malini's clones of the repositories in its scope as `additionalDirectories`.
  A started workstream learns which chat started it and reads its siblings' checkouts.
  A changed lineage restarts Claude Code, like a changed theme (0038).
- `localRepositoriesFromProjects` drops the lead space, so it is never a repository: not in the repository list, `repositories_list`, the catalog or a sidebar repository row.
  Pull request polling and change totals skip leads.
- A lead's page counts its workstreams in the top bar, through the same `globalTopBarGithubStatus` a pull request uses, with no Draft or Merge.
  The lead space is no repository, so a lead shows no extension panel and no **Add extensions**: its inspector stays shut until its agent opens a browser tab, and then holds only browser tabs (`hasInspector` on `InspectorSplit`, `browserOnly` on `WorkstreamInspector`).
  Shut, it leaves an empty dock (`dockInspector(compact, empty)`), so the top bar card closes under the status, the Jobs card stays docked, and the chat keeps the width it has in the lead's workstreams.
  Extensions still run for a lead, so a file its agent opens with `files_open` opens in a tab beside the chat.
  `displayWorkstreamName` calls a lead **New chat** until Name chats names it.
- The transcript folds every `workstreams_create` call a turn made into one **Workstreams** card where the first one ran (`foldStartedWorkstreams`), drawn by the app domain through a `ChatSurface` snippet, so the chat domain never reads pull request state.
  A started workstream shows **Started by** and its siblings above its transcript, through a second snippet.
- The sidebar is `sidebarTree` (`src/lib/app/domain/sidebar-tree.ts`): a focus strip with All and the owners and repositories you pin (localStorage `malini.app.sidebar-focus:v1`), then Home chats under **New chat**, then one block per owner holding its chats and its repositories, then repositories without an owner.
  A workstream folds under the workstream that started it while that one is listed in the focus, and otherwise sits under its repository; a repository lists while it holds work of its own or while it is open.
  Each level steps in 8, 24, 36 then 48 px.

## Consequences

- A lead is a chat in every way that already exists: tabs, approvals, Name chats, MCP servers, archive and restore, with no second kind of place in the chat code.
- Anything that lists workstreams sees leads too and has to decide: the sidebar, `workstreams_list`, pull request polling and change totals skip scoped workstreams, and a lead has no repository context.
- A lead plans from clones that can lag GitHub, and it still has Bash, so "never edits code" is its tool list plus its instructions, not a sandbox.
- A workstream started later changes its siblings' lineage, so their Claude Code restarts at their next turn.
- Enforced by `migrations.test.ts`, `workstreams.test.ts` (the lead space and lineage on real git), `instructions.test.ts`, `session.test.ts` and `protocol.test.ts` in the bridge, `sidebar-tree.test.ts`, `sidebar-focus.test.ts`, `lead-progress.test.ts`, `activity-group.test.ts`, `render-projector.test.ts`, `workstream-names.test.ts`, `inspector-dock.svelte.test.ts`, and `tests/e2e/lead-chats.spec.ts`.
