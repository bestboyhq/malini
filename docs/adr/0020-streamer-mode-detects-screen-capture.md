# 0020 - Streamer mode detects screen capture, not only streaming apps

Status: accepted

## Context

Streamer mode's Auto setting blurred personal data only while a known streaming app, such as OBS, was running, found by matching `ps` output against app bundle names.
The user records with Grip, which this missed.
Grip lives in the menu bar all the time and records in-process through ScreenCaptureKit, so a running Grip says nothing about recording and has no recorder process to match.
macOS has no public API that tells an app another app is capturing the screen.
The private CoreGraphics function `CGSIsScreenWatcherPresent` returned true while a ScreenCaptureKit stream or `screencapture -v` ran on macOS 27, false once it stopped, and stayed false for one-off screenshots.

## Decision

- `StreamingDetector` in `src/lib/app/platform/streaming.ts` asks, every 5 seconds, both `ps` for the streaming apps in `STREAMING_APPS` and `/usr/bin/osascript -l JavaScript` for `CGSIsScreenWatcherPresent()`, bound through JXA's `ObjC.bindFunction`.
- Auto blurs while either says yes, still through the `app:streaming-changed` event and the `app.streaming` command.
- A probe that fails keeps its last answer, so one failed check never unblurs a recording, and a probe that never works leaves the app list working.
- Apps that sit in the menu bar all the time, such as Grip, stay out of `STREAMING_APPS`; screen capture covers them.

## Consequences

- Any app that records or shares the screen, including Grip and screen sharing in calls, turns blurring on with no list to keep up.
- Malini depends on a private macOS function; if a later macOS removes it, the probe fails and Auto falls back to the app list alone.
- Each check spawns one more short process, about 50 ms.
- Blurring starts up to 5 seconds after capture does.
- Enforced by `src/lib/app/platform/streaming.test.ts` (either source turns streaming on, a failed probe keeps it) and `tests/e2e/streamer-mode.spec.ts` (Auto blurs while a streaming app runs); the private function itself is checked only by hand, since the e2e harness cannot record the screen.
