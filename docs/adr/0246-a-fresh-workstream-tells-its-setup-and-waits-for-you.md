# 0246 - A fresh workstream tells its setup and waits for you

Status: accepted

## Context

A new workstream opened on an empty center and the inspector's gutter (0228), and Simon found it "quite poor experience": "they see the gutter on the right and one huge empty space in the middle."
They asked for the middle to show "that we did some step, then we did some another step, and now it's time for the user", with prompts to pick from, because "people are clearly getting lost in this new work stream situation."
Starters showed only while a workstream was the only one (0242), so the second workstream got nothing.
Setup progress lived in memory, in the gutter's provisioning card, and a finished install cleared its record, so nothing was left to tell once setup ended.
Of three prototypes they picked the timeline, asked for the starters as a list rather than a grid, and asked for one that runs the workstream and opens it in the browser.
On the build they named the four starters, "And I think that's it", and asked about the top bar's **Build something great**: "I don't know why would you still have built something great in top right corner?"
The first steps named the branch and the head commit, and they found them "too technical": "It should be maybe creating a fresh copy, then the second one should be checking dependencies or something like that, and then it should be your turn."
**Your turn** as the last row looked like a row you could click, so they asked for it as "a label on top of the border of ... this whole container", without a border around each starter: "too many borders is not good".
They then asked to "replace your turn agents are stretching with quick suggestions", in a "dimmed out text color", and to make "this big white dot like an empty circle".
A failed setup showed a full-width banner above the chat, with the failure in mono and **Retry setup** and **Remove**, and they asked to "get rid of this fucking cheap status topbar pls, dear god we should never have it", then said they meant "only ... this middle bar": "Completely mismatched design".
The hidden gutter gave its column to the chat, which grew to the full width and then jumped left at the first message: "why is this center panel so fucking wide?"
They wanted the gutter to wait all the same: it "shouldn't be there until someone sent a message ... but it doesn't mean that our chat width should go bananas."
With the column kept, the chat sat left of an empty space, and they asked that it be "centered, and then when we add right gutter, it should push the chat column."
The gutter's card then slid in alone while the top bar's status sat as a loose pill in the corner: "The right gutter was always supposed to be just a single element always."

## Decision

- **Setup steps.** `WorkstreamSetupSteps.svelte` in `$shared/repositories/presentation` draws `workstreamSetupSteps` from `domain/workstream-setup-steps.ts`, one row a step on a rail, in plain words and never a branch, a commit or a command.
  While setup runs, it shows **Making a fresh copy**, with the clone percent.
  Once setup settles: **Made a fresh copy**, **Main won’t notice**, or **Picked up your branch** for a branch Malini did not name `malini/<id>`; then **Checking dependencies**, which ends as **Checked dependencies** with **All in place**, **Nothing to install** or **No lockfile. Installed nothing**, or as **Install failed** with the reason and **Retry**.
  A workstream another chat started (`startedBy`) ends instead on **Prompt from <that workstream>**, **Sends once setup is done**, and lists no starters: its first prompt is already waiting.
- **Quick suggestions labels the starters.** Once setup settles, the steps end in a `<fieldset>` whose `<legend>`, **Quick suggestions** in the dimmed text color, sits on its top border, and the rail runs into the legend's empty circle.
  The starters sit inside, the composer's width, with no fill and no line between them; a row shows a background only on hover or focus.
  The fieldset is a group named by its legend, so the label is no row to click.
- **No sync claim.** There is no "Caught up with main" step: a failed base sync only toasts and nothing records it, so the row would claim what nobody checked.
- **A finished install stays.** `visibleInstallStatus` maps `succeeded` and `already-installed` to `installed`, and `no-manifest` to `none`, in memory for the session, so a project with nothing to install says so.
  `DependencyInstallBanner` ignores `installed` and `none`, and `ChatSurface` hides the banner while the steps show.
- **Ways to start.** `FreshChatSuggestions.svelte` lists four starters under **Quick suggestions** in every workstream with no chats: **Run it in the browser**, **Find the biggest CI/CD pipeline optimizations**, **Find all implicit state machines** and **Plan a change with me**.
  Each fills the composer through `fillComposerCommand`; **Plan a change with me** also sets the run profile to plan mode, and every other starter sets it back to agent.
  The two finders list what they find, biggest or riskiest first, and change nothing until the user picks one.
  **Take one open issue** is gone: on a repository without open issues it sent the agent looking for nothing.
- **No status with nothing to ship.** `pullRequestTopBar` returns no status for a workstream with no changed files, so the top bar shows nothing where it said **Build something great**, and the empty docked header hides itself.
  The setup steps already say whose turn it is.
- **A failed setup says so in its steps.** The copy step turns into **Copy failed** with the reason, as **Install failed** does, and the row holds **Retry** and **Remove**; the full-width banner, `WorkstreamProvisioningFailure.svelte`, is gone, which amends 0073's setup banner.
  **Copy failed** adds the GitHub sign-in remedy when the failure is a sign-in, as the top bar's tooltip does.
  The top bar keeps **Setting up** and **Needs you · Setup failed** with **Retry** on the gutter's card, so they wait with the gutter, and the steps say it meanwhile.
  A failed setup takes the sidebar's `broken` tone, so its row's icon turns red as a missing checkout's does, where the pull request's gray hid it.
- **The gutter waits, its width kept.** `WorkstreamLayout.svelte` makes the inspector's column `invisible` in a workstream made in this session, on its `malini/<id>` branch, with no chats, no changed files, no browser tab, no live automation and the drawer closed.
  No chats is `workstreamChatsQuery`, never `recentChatsQuery`: a new chat drops out of the recent ones while its loaded transcript is still empty, and the gutter came in, went out and came in again at the first message.
  Made in this session is `provisioningRecordQuery.madeHere`: `WorkstreamProvisioningAggregate.begin` marks the id, and settling keeps the mark.
  A workstream that already existed at launch keeps its gutter, so an empty one never flashes it away while its chats load, and Files and Browser stay one click away in it.
  The column stays mounted and keeps its width, so the chat is as wide before the first message as after it.
- **The gutter pushes the chat.** While the gutter waits, it sits one column to the right, out of view, and `ChatSurface` moves its transcript stage right by half the column, so the chat column is centered in the whole width; the tabs stay.
  When the gutter shows, a `Tween` of 240 ms with `cubicOut` slides it in and moves the stage back, so the chat stays centered in what is left of the width at each frame.
  Moving to another workstream, or reduced motion, sets both at once.
  Both move with `left`, never `transform`, so a popover with `position: fixed` inside the composer still opens at its trigger.
  `visibility: hidden` also takes the gutter out of the tab order and the accessibility tree.
- **The top bar's status and the gutter are one card.** `inspectorDock.slideWith` hands the top bar the gutter's offset, so the docked header moves with the gutter's card on every frame and hides while the card is out of view; there is never a loose pill beside a sliding card.
  A header that arrives with the sliding gutter has no entrance of its own: its fade and rise are a `@starting-style` that applies only on a dock in place, so a status that appears on a gutter already in view still fades in.
- This amends 0242's starters and 0228's gutter, which now shows from the first message, or earlier once there is something in it to see.

## Consequences

- A new workstream reads as what Malini did and ends on the user, and each row comes from state Malini already holds.
- After a relaunch, setup and install records are gone, so an untouched workstream shows **Made a fresh copy** only, with its gutter.
- In a workstream just made, Files and Browser have no gutter row until the first message; a change, a browser tab, an agent's reveal or an automation brings the gutter back.
- `tests/e2e/workstream-setup.spec.ts` fails when a failed setup shows an alert banner, loses **Copy failed** with its reason, **Retry** or **Remove** in its steps, or when the top bar shows its status while the gutter waits, or its label and detail overlap.
- `src/lib/shared/repositories/domain/workstream-setup-steps.test.ts` fails when a step's wording or state drifts, `provisioning.test.ts` when an install outcome stops mapping to a step, and `workstream-provisioning.aggregate.svelte.test.ts` when a finished install loses its record or its command, or a settled workstream loses its made-here mark.
- `tests/e2e/first-run.spec.ts` fails when the steps, the four starters inside the **Quick suggestions** group, plan mode on **Plan a change with me**, or the hidden gutter go.
- `inspector-dock.svelte.test.ts` fails when the dock stops reporting the gutter's offset, or keeps it once the gutter lets go.
- `pull-request-top-bar.test.ts` and `tests/e2e/pull-request-nothing-to-ship.spec.ts` fail when a workstream with nothing to ship shows a status again.
