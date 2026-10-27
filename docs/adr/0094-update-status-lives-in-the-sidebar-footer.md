# 0094 - Update status lives in the sidebar footer

Status: accepted

## Context

Update status was spread over three surfaces.
The app menu item changed its label to Checking for Updates…, Downloading Update… and Restart to Update, the sidebar showed a Restart to update button only once an update was staged, and `updates.ts` opened native dialogs for "up to date", "could not check", "could not download" and "ready to install".
Picking Check for Updates… showed nothing where the user was looking, and a staged update after an asked check popped a dialog in the middle of the screen.
The user asked for "one place in the whole system responsible for showing the updates channel status", the same place as the button that installs an update, and said a mid-screen pop-up about a new version "should never be the case".
The Jobs page swaps in its own sidebar, so the staged update button also vanished there.

## Decision

- The main process owns one `UpdateStatus` (`$contract/events`): `idle`, `checking`, `downloading`, `up-to-date`, `failed` or `ready`.
  `src/lib/app/platform/updates.ts` publishes it on `app:update-status-changed`, which the event log skips, and answers `app.update-status`, which replaces `app.staged-update`.
  The `app:update-staged` event stays for jobs.
- A check Malini starts on its own (launch, every hour, wake) stays silent; only a check you asked for, from Check for Updates… or `app.check-for-updates`, shows `checking`, `downloading`, `up-to-date` (for eight seconds) or `failed`.
  A staged update shows `ready` over any result.
- `UpdateStatus.svelte` renders it inside `SidebarFooter.svelte`, so the workstreams sidebar and the Jobs sidebar show the same row: a status line while checking, downloading or up to date, Update failed with Retry and the error in a tooltip, or Restart to update.
  When an asked check starts with the sidebar collapsed, `showUpdateStatusCommand` opens it.
- `updates.ts` opens no dialog about an update, and the app menu always shows the same Check for Updates… item.
  The one prompt left is Move to Applications at launch, which decides whether updates can install at all.

## Consequences

- Update feedback appears where the install button appears, on every page that has a sidebar, and nothing interrupts the user about a new version.
- Onboarding has no sidebar, so a check asked for during onboarding shows nothing until it ends.
- New update states go into `UpdateStatus` and `UpdateStatus.svelte`, never into a dialog, the menu label or a toast.
- `pnpm --filter malini test:update` enforces it on signed builds: it fails when the app menu shows Restart to Update, and it drives Check for Updates… through checking, up to date, failed with Retry and downloading, asserting each row in the sidebar.
  Nothing enforces the absence of dialogs beyond review of `updates.ts`.
