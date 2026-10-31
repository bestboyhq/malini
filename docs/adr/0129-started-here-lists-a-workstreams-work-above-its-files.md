# 0129 - Started here lists a workstream's work above its Files

Status: accepted

## Context

0088 kept the progress dots, the hover card and the top right list on a workstream that started work, but only a lead's page drew that list, in the dock its inspector leaves empty (0076).
A workstream of a repository fills its inspector with **Files**, so its page showed no list, and the user found "there also isnt a way to see external workstreams within it".
A lead lost its list the same way once its agent opened a browser tab, since the dock only renders while the inspector holds no panel.
The user floated each started workstream as another chat tab; two prototypes, tabs and a list above **Files**, were weighed, and the user picked the list ("Go with variant B (Started here)").
That prototype named each row by its workstream and repository, where 0076 showed only the repository; two started workstreams in one repository read the same under 0076.
The sidebar row of such a workstream also showed its dots in place of its own lines added and removed.
This changes 0076's top right list and row lines; the rest of 0076 stands.

## Decision

- `WorkstreamPage.svelte` reads `leadProgressQuery.startedIds` for every workstream, not only a lead, and passes its list as `dock` while it has started work or open decisions.
- `ExtensionInspectorShell.svelte` takes a `header` snippet and draws it at the top of the inspector card, above the panel tabs and the gutter, with a hairline under it; `WorkstreamInspector.svelte` passes `dock` as that header, and keeps the separate dock card for an inspector with no panel.
- `StartedWorkstreams.svelte` takes a `heading`: unframed, it draws **Started here** with how many of them merged, as **Your decisions** draws its own.
- Each row shows the workstream's name, then its repository's short name in `text-fg-quaternary`; a workstream without a name shows the repository alone.
- `Sidebar.svelte` draws a row's own trail, lines added and removed, a draft or the queue, and then its progress dots, instead of one or the other.

## Consequences

- Every page that started work shows it at the top right, a repository workstream's and a lead's with browser tabs alike, and a row opens the workstream it names.
- The list costs the inspector height; `max-h-64` scrolls a long list so **Files** keeps most of it.
- Rows in the transcript's **Workstreams** card and the sidebar's hover card name the workstream too.
- Enforced by the e2e test "an agent clones a repository, starts and archives a workstream in it without asking, hides it, and Activity shows every call with its outcome" in `tests/e2e/agent-actions.spec.ts`, which checks the starting row's totals beside its dots, **Started here** with the open workstream as a link, and the archived one as a row once archived.
