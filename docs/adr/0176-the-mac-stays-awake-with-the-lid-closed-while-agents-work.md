# 0176 - The Mac stays awake with the lid closed while agents work

Status: accepted

## Context

A turn can run for an hour, and a MacBook sleeps the moment its lid closes, which cuts the turn.
The user asked to bring [Close My Lid](https://github.com/krishkalaria12/close-my-lid) by Krish Kalaria (MIT) into Malini, with a setting for it, and to credit him in the pull request and the changelog.
Its notes explain why a power assertion is not enough: macOS sleeps a closed lid anyway, and only `pmset -a disablesleep 1` keeps it awake.
That command needs root, and `disablesleep` survives the process that set it and a reboot, so a crash would leave the Mac unable to sleep.
Close My Lid holds for a time you pick; Malini knows when agents work, so it can hold only then.

## Decision

- **Settings → Power → Keep working with the lid closed** sets `app.lid-hold` to `on` or `off` through `app.hold-lid`, off until turned on.
- Turning it on first checks for the rule with `sudo -n /usr/bin/pmset -a disablesleep <current value>`.
  Without it, one `osascript … with administrator privileges` prompt writes `/etc/sudoers.d/malini`, checks it with `visudo -cf` and moves it into place.
  The rule is Close My Lid's: `%admin ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0`, so its own rule works too and no prompt shows.
  A canceled prompt leaves the switch off; an account the rule does not cover gets an alert under the switch.
- `startLidHold` in `src/lib/app/platform/lid-hold.ts` holds while the setting is on, `openAgentRunCount` is above zero and the Mac is not on battery at 5% or less (`pmset -g batt`), the floor Close My Lid uses.
  It settles on `app:started`, on every `run.started`, `run.completed` and `run.failed`, every 60 seconds, and at quit, one settle at a time.
- If `pmset -g` already shows `SleepDisabled 1` when Malini wants to hold, the hold is someone else's, and Malini leaves it alone.
- While it holds, Malini runs `/bin/sh -c 'read _; exec sudo -n /usr/bin/pmset -a disablesleep 0'` detached, with Malini holding its stdin.
  When Malini dies, the pipe closes and the watchdog turns sleep back on; a release Malini makes itself kills it.
- `app.lid-held` is `yes` while Malini holds, so a launch after a power loss or a reboot turns sleep back on before anything else.
- `MALINI_LID_TOOLS` points an unpackaged build at fake `sudo`, `pmset` and `osascript`; a packaged build always runs `/usr/bin`.
- NOTICE, the About panel, the docs and the pull request title credit Close My Lid and Krish Kalaria.

## Consequences

- A turn keeps going in a closed MacBook, and the Mac sleeps once no turn runs, with no timer to pick.
- Malini now writes a file to `/etc/sudoers.d`, which stays after Malini is gone; `sudo rm /etc/sudoers.d/malini` removes it, as the chat docs say.
- Sleep stays off while a run is open even if that run waits on nothing, until it ends or the battery reaches 5%.
- A Mac that loses power while held stays unable to sleep until Malini launches again.
- Enforced by `lid-hold.test.ts` (reading `pmset`, the battery floor, the AppleScript quoting, fake tools only unpackaged) and `lid-hold.spec.ts` (one prompt, a canceled prompt, holding only while a turn runs, letting go when the switch turns off and at quit, the watchdog after a `SIGKILL`, and the marker on the next launch).
