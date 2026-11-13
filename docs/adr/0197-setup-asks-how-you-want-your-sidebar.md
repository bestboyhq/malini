# 0197 - Setup asks how you want your sidebar

Status: superseded by 0242

## Context

The sidebar groups by organization and repository, with Manual order and every status listed.
Its panel already offered Status, Day, flat sections and four orderings, and Settings offered a density, but nothing offered a list of only the work that needs the user, and a new install never saw any of it.
The user called it "the most opinionated piece of our entire system" and said "people may have different work styles", with one person on "a single project" who wants "grouping by status" and "only work streams that require his attention".
They wanted a setup step with clear names, and picked **Two questions**, "where do you work" and "what should it show", over three preset cards, then added "we should probably also ask someone if they want compact or comfort rows".
0179 left setup at four steps, and Compact had just become the default density.

## Decision

- **Setup has five steps.**
  `ONBOARDING_STEPS` in `src/lib/app/domain/onboarding.ts` is `accounts`, `sounds`, `sidebar`, `defaults`, `heard-about`, so **Set up your sidebar** is step 3 of 5.
  It asks **Where do you work?** (**Many repositories** or **One project**), **What should it show?** (**Everything** or **Only what needs me**) and **How tall should rows be?** (**Compact** or **Comfortable**), beside a preview of the sidebar those answers make.
  **Skip** keeps Organization grouping, Everything and Compact, and nothing is applied until **Continue**.
- **The answers are the sidebar's own settings.**
  `onboardingSidebarArrangement` turns the first two answers into a `SidebarArrangement` and **Continue** saves it through `arrangeSidebarCommand`, and the third through `chooseSidebarDensityCommand`, so Malini stores no onboarding answer and the panel and Settings read the same values.
  Many repositories showing everything is the default arrangement, many repositories showing what needs you groups by Status with each section sub-grouped by repository, and one project groups by Status with no sub-grouping.
- **A sidebar can show only what needs you.**
  `SidebarArrangement` has `show`, `everything` or `attention`, and `attention` keeps the **Needs you** and **In review** sections of a Status grouping, in `ATTENTION_SECTIONS` in `src/lib/app/domain/sidebar-sections.ts`.
  `arranged` in `sidebar-arrangement.ts` keeps `show` and `grouping` consistent: picking `attention` groups by Status, and leaving Status shows everything again.
  `sidebarTree` counts what the filter hides, the sidebar lists it as **N hidden** with **Show all**, and says **Nothing needs you.** when no section is left.
  The panel's **Show** row and the setup step set the same value, and `readSidebarArrangement` reads a value saved without it as `everything`.
- The preview is the real `sidebarTree` in `src/lib/app/domain/onboarding-sidebar-preview.ts`, so it cannot drift from the sidebar it previews.
  It lists your four most recent GitHub repositories, with their owners' avatars, read through `gh` as the first-repository picker reads them, and shows sample work in them.
  It shows skeleton rows while the list loads, and sample repositories when `gh` is signed out, fails or lists none.
- This changes 0179's `ONBOARDING_STEPS` line only in the new step; the rest of it stands.

## Consequences

- A new user picks how the sidebar groups, what it hides and how tall its rows are before the first repository, and each answer stays one click away in the panel and in Settings.
- An install that finished setup before this never sees the step and keeps its sidebar as it was.
- A saved arrangement from before has no `show` and reads as `everything`, so nothing changes for it.
- The global **New chat** row still starts a chat at Home when the list shows only what needs you; asking for a repository there waits on the decision about Home chats.
- Enforced by `src/lib/app/domain/sidebar-arrangement.test.ts` (the pairing of `show` and `grouping`, and the saved value read as `everything`), `src/lib/app/domain/sidebar-tree.test.ts` (the filter and its hidden count), `src/lib/app/domain/onboarding.test.ts` (each answer's arrangement), `src/lib/app/domain/onboarding-sidebar-preview.test.ts` (the preview lists and hides as the sidebar does) and `tests/e2e/sidebar-setup.spec.ts` (the answers reach the sidebar, **Show all** and the panel's **Show** row work, and **Skip** keeps the default).
