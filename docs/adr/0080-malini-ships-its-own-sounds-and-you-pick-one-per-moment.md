# 0080 - Malini ships its own sounds, and you pick one for finished and one for needs you

Status: accepted

## Context

One chime, `src/lib/shared/system/chime.wav`, played for every attention decision: a finished run, a question, an approval and a failed run sounded the same.
It played at -33 LUFS, far below the -25 to -29 LUFS of the macOS alert sounds, and nothing could change or turn it off.
The user asked onboarding to let people choose the sound, and their own: "we could let them set their own sound even", recorded or from a file.
Synthesized sounds were "AI sounding slop", and the macOS alert sounds were ruled out because the user wants "consistent experience on every single platform with sounds. Not platform specific ones."
Apple's sounds cannot be bundled anyway, so only sounds Malini may redistribute qualified; the user picked 17 of 54 candidates by ear.

## Decision

- Malini bundles 17 sounds in `apps/malini/src/renderer/public/sounds/`: its own chime, 14 from the Android Open Source Project under Apache 2.0 and 2 from the KDE Ocean sound theme under CC BY-SA 4.0.
  Each is leveled to -25 LUFS, the loudness of the macOS alert sounds, and stored as FLAC so it loses nothing more.
  `LICENSE.md` beside them credits every file and its original, and `LICENSE-APACHE-2.0.txt` carries the Apache text.
- Two settings pick what plays: `sounds.finished` when an agent finishes and `sounds.needs-you` when it asks a question, needs an approval or fails.
  Unset, they are `chime` and `tethys`; `none` turns one off.
  Every moment that chimed before (0009, 0037, 0047) now plays the sound for its attention kind: `completed` plays finished, `input`, `approval` and `failed` play needs you (`attentionSoundSignal` in `src/lib/chat/domain/agent-attention.ts`).
- Your own sounds join both lists.
  A recording is up to 3 seconds from `MediaRecorder`, and a file is up to 5 MB, picked with the native open dialog in the main process.
  Both live as BLOBs in the `custom_sounds` table, with `sounds.list`, `sounds.read`, `sounds.add` and `sounds.pick-file`.
- Recording asks the system for the microphone first, with `sounds.ask-microphone` (`systemPreferences.askForMediaAccess` on macOS), so pressing Record records.
  When access is off, `sounds.open-microphone-settings` opens the Microphone pane of System Settings.
  The signed app carries `com.apple.security.device.audio-input` in `build/entitlements.mac.plist`, beside electron-builder's defaults, and `NSMicrophoneUsageDescription`.
- `$shared/sounds` is a shared domain, because chat plays the sounds while app's onboarding (step 3 of 4, "Hear your afternoon") and Settings → Sounds show them.
- Malini's browser no longer refuses a page's microphone or camera silently: it asks in a sheet on the Malini window and remembers each answer per site until Malini quits.
  Every other permission stays denied.

## Consequences

- Every Mac, and any platform Malini reaches later, hears the same sounds at the same loudness.
- Shipping a sound now means checking its license, crediting it in `LICENSE.md` and leveling it to -25 LUFS.
- A recording or a file you add stays in the database until a way to remove one exists.
- Enforced by `src/lib/shared/sounds/platform/register.test.ts` (your sounds, their limits, the file picker), `agent-lifecycle-monitor.service.test.ts` (which moment plays which sound), `src/lib/browser/platform/media-permission.test.ts`, `tests/e2e/sounds.spec.ts` (onboarding, Settings → Sounds, a refused file, the microphone turned off) and `tests/e2e/browser-media-permission.spec.ts`.
  Nothing checks the loudness or the licenses of the files.
