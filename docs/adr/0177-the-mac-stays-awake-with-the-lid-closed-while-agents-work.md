# 0177 - The Mac stays awake with the lid closed while agents work

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
- The hold never outlives the Malini that took it, because launchd, not Malini, cleans up after it.
  Turning the switch on writes `~/Library/LaunchAgents/app.malini.desktop.lid.<sha256 of the data folder, 12 hex>.plist` and loads it with `launchctl bootstrap gui/<uid>`; turning it off boots it out and deletes it.
  Every acquire first checks it with `launchctl print` and reloads it when it is missing or stale, and refuses to hold when launchd will not take it.
  It runs `/bin/sh` every 30 seconds and at login, `RunAtLoad`, as Close My Lid's watchdog agent does every 60.
- Before `pmset -a disablesleep 1`, Malini writes `lid-held` in its data folder: its pid, then `ps -o lstart=` for that pid under `LC_ALL=C TZ=UTC0`.
  The agent turns sleep back on with `sudo -n` and deletes the file when that pid no longer runs or started at another time, so a reused pid after a reboot does not count.
  A Malini that releases itself deletes the file, and a launch that finds it left over turns sleep back on before anything else.
- A heartbeat was rejected: App Nap throttles the timers of a Malini with no visible window, as with the lid closed, and a late beat would let the Mac sleep mid-turn.
  A watchdog child on a pipe was rejected too: it dies with Malini's process tree, which left `SleepDisabled 1` with nothing running during the first live test.
- `MALINI_LID_TOOLS` points an unpackaged build at fake `sudo`, `pmset`, `osascript` and `launchctl` and its own `LaunchAgents`; a packaged build always runs `/usr/bin` and `/bin`.
- NOTICE, the About panel, the docs and the pull request title credit Close My Lid and Krish Kalaria.

## Consequences

- A turn keeps going in a closed MacBook, and the Mac sleeps once no turn runs, with no timer to pick.
- Malini now writes a file to `/etc/sudoers.d`, which stays after Malini is gone; `sudo rm /etc/sudoers.d/malini` removes it, as the chat docs say.
- Sleep stays off while a run is open even if that run waits on nothing, until it ends or the battery reaches 5%.
- Within 30 seconds of Malini dying by any means, sleep is back; after a power loss, once the user logs in.
- macOS shows its "Background Items Added" notice when the switch first turns on, and lists the agent under Login Items, where turning it off makes Malini refuse to hold.
- Removing Malini with the switch on leaves the agent behind, a check every 30 seconds that finds no `lid-held` and exits.
- Enforced by `lid-hold.test.ts` (reading `pmset`, the battery floor, the AppleScript and plist quoting, fake tools only unpackaged) and `lid-hold.spec.ts` (one prompt, a canceled prompt, the agent loaded with the switch and removed without it, holding only while a turn runs, letting go when the switch turns off and at quit, the agent leaving a live Malini alone and releasing a `SIGKILL`ed one, never touching a hold that is not Malini's, and the leftover file on the next launch).
