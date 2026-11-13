# 0240 - Sidebar options asks setup's questions, Repositories first

Status: accepted

## Context

0197 made setup ask **Where do you work?**, **What should it show?** and **How tall should rows be?**, while the sidebar's panel kept its own rows: Grouping, Sub-grouping, Show and Ordering.
So the panel asked different questions than setup, in different words, about the same values.
The user asked to "simplify the sidebar options menu so it asks the same three questions as onboarding, and move Grouping, Sub-grouping and Ordering under a collapsed Advanced section", and approved the Inline prototype.
Then they found the first question off: "where you work is a little weird", "it has to make sense for someone reading it", and "I just don't know if where you work many repositories for one project is exactly the angle".
The answer never said where you work: it picks a layout, each repository in its own group or one list by status, and **Many repositories** and **One project** counted different things.
Of three wordings, **You work in**, **Repositories** and **Find work by**, they picked **Repositories**.

## Decision

- The panel behind the sliders button in `SidebarFocusStrip.svelte` is **Sidebar options**.
  It asks **Repositories** (**Separate** or **Mixed**), **Show** (**Everything** or **Only what needs me**) and **Row height** (**Compact** or **Comfortable**), each a full-width `ChoiceSwitch` (`fill`).
  The labels live in `src/lib/app/presentation/sidebar-preset-copy.ts`, which setup reads too, and setup asks the first as **Keep repositories separate?**.
- **Repositories** and **Show** run `chooseSidebarPresetCommand`, which saves `presetArranged` from `src/lib/app/domain/onboarding.ts`: the arrangement `onboardingSidebarArrangement` makes for the answers, with the current ordering.
  The sidebar's **Show all** goes through it too, so it lands on a preset.
  **Row height** runs `chooseSidebarDensityCommand`, the setting Settings, Appearance shows.
- Malini stores no answer.
  `sidebarPreset` reads them from the arrangement: **Mixed** when it groups by Status or Day with no sub-grouping, **Separate** otherwise, and **Show** as saved.
- **Advanced** folds Grouping, Sub-grouping and Ordering below the questions, which still save through `arranged`.
  It opens closed each time the panel opens, and nothing stores it.
  `customArrangement` marks it **Custom** when the grouping or sub-grouping differs from the answers' preset or the order is not Manual, and only then does **Reset** show, going back to that preset in Manual order.
- This changes 0197's first question and drops its panel **Show** row; the rest of 0197 stands.

## Consequences

- Setup and the panel ask the same questions in the same words, and a sidebar tuned by hand reads as **Custom** instead of a wrong answer.
- **Repositories** names what changes, so it stays true under **Only what needs me**, where **Separate** sub-groups each Status section by repository.
- An arrangement saved before reads as answers without a migration: Organization or Repository grouping reads as **Separate**.
- Enforced by `src/lib/app/domain/onboarding.test.ts` ("sidebar options": the answers read back, a pick keeps the order, **Show all** lands on a preset, and what counts as custom), `tests/e2e/sidebar-sections.spec.ts` (Advanced, **Custom**, **Reset** and the answers following the grouping) and `tests/e2e/sidebar-setup.spec.ts` (setup's answers show in **Sidebar options**, and its **Show** and **Row height** change the sidebar).
