# 0273 - Nothing sits above the chat, setup errors are setup steps, and a checkout repairs itself

Status: accepted

## Context

0250 removed the full-width setup failure banner after the user asked to "get rid of this fucking cheap status topbar pls, dear god we should never have it".
It recorded the removal of one component and no rule, and its test only failed when a failed setup showed an alert banner.
0271 then added the same strip for a broken checkout, and two more of them were still in the code: one for the dependency install and one for a workstream with no usable checkout.
The user saw "This folder lost its link to git" in that strip and asked for it to be "entirely fucking gone from this code base", with errors as "part of the setup timeline that the user sees in a new workstream".
They then asked "why do we have a repair button?": "it should just auto-repair itself".
0271 gave no reason to wait for a click: its repair keeps a copy of each git file it replaces and never touches working files.
This amends 0250 and replaces the banner line of 0271.

## Decision

- **No strip above the chat.** `ChatSurface.svelte` renders the chat and nothing above it.
  `CheckoutHealthBanner.svelte`, `DependencyInstallBanner.svelte`, `WorkstreamProvisioningBanner.svelte` and `WorkstreamCheckoutIssue.svelte` are deleted, and no component takes their place.
- **A setup error is a setup step.** `workstreamSetupSteps` in `$shared/repositories/domain/workstream-setup-steps.ts` adds a `checkout` step between the copy and the install.
  A broken checkout fails it with the finding's headline and its repair or instruction line from `checkout-finding-copy.ts`, now in `domain`; a repair in progress shows **Repairing the checkout**; a workstream whose checkout Malini cannot use shows **No usable checkout** with the reason.
- **A step names its action.** Each step carries `action`: `retry-setup`, `repair`, `retry-install` or none, and `WorkstreamSetupSteps.svelte` draws the button from it, so **Repair** shows only for a finding Malini can repair.
- **The top bar carries it where the steps do not show.** The steps show only in a workstream with no chats.
  `setupStepTopBarStatus` in `provisioning-top-bar-status.ts` turns the first failed step, or a repair in progress, into the top bar status every workstream has: **Needs you** with **Checkout broken** or **Install failed**, the step's label and detail as the tooltip, and **Repair**, or **Retry** and **Dismiss** for a failed install.
  `WorkstreamPage.svelte` passes it as `overrideStatus` after the provisioning status of 0250.
- **A checkout repairs itself.** `CheckoutHealthGuard` in `platform/checkout-health.ts` runs the repair as soon as the doctor names a repairable finding: the state goes from `healthy` to `repairing`, never through `broken`.
  The reads that found the break wait for the repair and run again once the checkout is healthy, so they fail no command.
  A repair that fails leaves the checkout `broken` and repairable, later probes do not repair again, and **Repair** in the step and the top bar is the retry.
  `usage-data.ts` sends `checkout broken: <finding>` once per break, on the first state that is not `healthy`, so a repaired break is still counted.
- **A running install is quiet outside the steps.** The install strip's three-second delay, `installNoticeAt` and `noticeAt`, is gone with the strip: a running install shows only as **Checking dependencies** in the steps, and "nothing says how to install" shows only as the skipped step.

## Consequences

- A status, a failure or an action for a workstream goes in the setup steps, the top bar status, the composer or the transcript, never in a new row above the chat.
- A workstream with chats sees a failed install as **Needs you** in the top bar until **Retry** works or **Dismiss** clears it, where the strip left the pull request status in place.
- `tests/e2e/checkout-health.spec.ts` fails when a checkout that lost its git link does not link itself again, when a checkout Malini cannot repair is not a failed setup step and a top bar status, or when the chat surface holds anything beside the chat.
- `checkout-health.test.ts` fails when a repairable break does not repair itself, when the reads that found it fail, or when a break Malini cannot repair spawns git more than once.
- A folder the user deleted on purpose comes back while its workstream is active; archiving the workstream is how to remove it.
  `tests/e2e/workstream-setup.spec.ts` fails the same way for a failed install.
- `workstream-setup-steps.test.ts` and `provisioning-top-bar-status.test.ts` fail when a step loses its action or the top bar loses the step.
- The chat-surface child count guards only that surface: nothing fails when a strip is added to another page.
