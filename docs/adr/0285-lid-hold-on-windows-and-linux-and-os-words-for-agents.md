# 0285 - Lid hold on Windows and Linux, and OS words for agents

Status: accepted

## Context

0177 keeps a MacBook awake with the lid closed through `pmset -a disablesleep`, which only macOS has.
Since 0280 Malini runs on Windows and Linux, where the same switch ran `pmset`, failed, and showed the Mac's refusal.
Each OS keeps the lid in its own place: Windows in the power plan's lid close action (`LIDACTION`, on mains and on battery), Linux in systemd-logind, which always honors a `handle-lid-switch` inhibitor lock.
The round 2 brief asked for each OS's own mechanism with the least privilege, the user's own setting back after a crash or kill, and one plain line where an OS cannot do it, never a silent failure.
The text agents read named the Mac on every OS: the event descriptions `events_list` returns, the automation trigger grammar, the sandbox refusal and the `browser_press` example, so an agent on Windows told its user about their Mac.

## Decision

- `startLidHold` in `src/lib/app/platform/lid-hold.ts` keeps 0177's core: it holds while the setting is on, a run is open and the battery is above the floor, and it settles on run edges, every 60 seconds and at quit, one settle at a time.
  It takes one driver by `osPlatform`: `macLid` makes 0177's calls in 0177's order, and `linuxLid` and `windowsLid` are new.
- `app.lid-hold` returns `{ on, available }`.
  The Power page takes its copy for the running OS from `osQuery`.
  When `available` is false, one line says so and the switch is off and disabled.
- Linux:
  - `systemd-inhibit --list --no-pager` succeeding, checked once per launch, means logind runs.
    Without it, as in a container or under elogind, the page reads "No systemd-logind here, so the lid does what it always does."
  - Holding runs `systemd-inhibit --what=handle-lid-switch --who=Malini --why='An agent is working' --mode=block /bin/sh -c 'echo held; exec cat'` as a child.
    `held` on its stdout means logind granted the lock.
    Closing its stdin ends `cat` and frees the lock, and a Malini that dies closes that pipe too, so the lock never outlives it.
    An inhibitor that exits on its own drops the hold, and the next settle takes it again.
  - Turning the switch on takes and frees the lock once, so a refusal shows under the switch.
    polkit's `org.freedesktop.login1.inhibit-handle-lid-switch` allows an active or inactive local session with no password and refuses a process outside any session.
  - No `sleep` lock: logind ignores a block lock held by the user who asks it to suspend, and its default `LidSwitchIgnoreInhibited=yes` ignores one on lid close.
    Electron's `powerSaveBlocker.start('prevent-app-suspension')` keeps the desktop's idle timer from suspending mid-turn instead.
  - The floor reads `/sys/class/power_supply`: a system battery, not a `Device` one, discharging, with a mean capacity of 5% or less.
- Windows:
  - `powercfg /getactivescheme` names the active plan by GUID, which no language changes, and `powercfg /q <plan> SUB_BUTTONS LIDACTION` gives the lid close action as its last two `0x` values, mains then battery.
  - A plan with no lid close action, which is every desktop PC and every VM, means no lid to hold: that read, checked once per launch, makes `available` false, and the page reads "No lid setting in this power plan, so the lid does what it always does."
  - Turning the switch on writes the current values back, so an account that may not change the plan sees the refusal under the switch.
  - Holding, when the plan does not already do nothing on lid close, writes `lid-held` in the data folder (Malini's pid, the plan, both values), sets both to 0 with `/setacvalueindex` and `/setdcvalueindex`, reads them back, and applies them with `/setactive` while the plan is active.
    Releasing writes the saved values back and deletes `lid-held`.
  - Before its first hold, Malini starts `powershell.exe -NoProfile -NonInteractive -EncodedCommand` detached and hidden.
    It waits for Malini's pid to exit and, when `lid-held` still names that pid, writes the saved values back and deletes the file.
    Detached, it is outside the job object that ends Malini's children with it, so a crash or `taskkill /f` leaves it running.
    A launch that finds `lid-held` left over, after "End process tree" or a power loss, puts the values back first, as on the Mac.
  - No UAC prompt: a standard user may change the active plan's values.
  - No floor: Windows runs its own critical battery action whatever the lid does.
  - `powerSaveBlocker.start('prevent-app-suspension')` keeps the idle timer from sleeping the PC mid-turn, and after release a closed PC sleeps on that timer.
- `MALINI_LID_TOOLS` also points an unpackaged build at a fake `systemd-inhibit`, `power_supply`, `powercfg` and `powershell`.
- `osText(text, os)` in `$shared/os` fills `{machine}`, `{tray}` and `{menu}` from `osFor`, which gains `menu` and `backspaceKey`, and Windows' `terminal` becomes PowerShell.
  `$contract/event-catalog.ts` descriptions carry those placeholders.
  `events_list` and the trigger picker fill them for the running OS, and `generate-contract-reference.mjs` fills the Mac's into `apps/site/content/reference/events.md`, so that page reads as before.
- The agent bridge cannot import `$shared/os`, so `packages/agent-bridge/src/claude/machine.ts` names the machine (Mac, PC, computer) for the trigger grammar and the sandbox refusal.
  `browser_press` gives `Control+K` off the Mac, and the browser steer also catches `xdg-open` and `start`.

## Consequences

- The switch works on all three OSes behind one core, and the Mac's calls, copy and Power page stay byte-identical.
- Windows now writes the user's power plan; a hold leaves 0/0 there until release, the watchdog or the next launch puts the values back.
  A plan the user switches to during a hold keeps its own values, and a change the user makes to the lid action during a hold is overwritten on release, as on the Mac.
  Two Malinis on one PC share the plan, so the first to let go puts the user's values back under the other.
- Not checked on a Modern Standby PC, where the screen going dark can start standby by itself.
- On Linux the hold needs systemd-logind and a local session.
  KDE Plasma's PowerDevil takes the lid itself and follows its own setting, which Malini leaves alone.
- Agent text says Mac, PC or computer by OS, and a new description that names an OS thing uses a placeholder.
- Enforced by `lid-hold.test.ts`: the parsers, the marker, the watchdog quoting and the read-back check on every OS; a fake `powercfg` with no lid close action making `available` false on every OS; on Linux CI, a real `systemd-inhibit` lock in Malini's name and its release, and the lid lock held or refused with logind's reason; on a Windows CI runner whose active plan has a lid close action, a real `powercfg` round trip, a write from a Basic User token (`runas /trustlevel:0x20000`), and the watchdog restoring the values once the holder dies.
- Enforced by `lid-hold.spec.ts` on Linux with a fake `systemd-inhibit`: the refusal under the switch, holding only while a turn runs, letting go when the switch turns off, at quit and when Malini is `SIGKILL`ed, and the line and disabled switch without logind; its Mac tests stay 0177's.
- Enforced by `os.test.ts` (`osText`), `service.test.ts` (`events_list` words), `permissions.test.ts` (the bridge words) and `pnpm check`, which fails when the generated reference is stale.
- Amends 0177; 0280's rule that every OS word comes from `osFor` now reaches agent text.
