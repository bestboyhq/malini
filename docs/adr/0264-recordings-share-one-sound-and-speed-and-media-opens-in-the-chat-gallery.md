# 0264 - Recordings share one sound and speed, and Media opens in the chat's gallery

Status: accepted

## Context

0229 opened a Media gallery tile in `MediaViewer` over `WorkstreamMedia`, while a chat's images and recordings open in `ImageGallery`, so the same file looked and behaved two ways.
The grid loaded every image at once and played every video tile, and on a real workstream with 960 media files it took 10.6 s to show.
Each `VideoPlayer` and `VideoCompare` kept its own mute, volume and speed, so every new recording started muted at 1×.
A click on a report recording opened the gallery, which the user did not expect from a video.
The user asked for a click on a recording to "be either play or pause, not zoom in", for sound to be global, "so if I set sound volume for one video, all other videos will have that applied", for speed to follow "the same logic", and for the Media viewer to "get aligned with the original one".

## Decision

- `VideoPreferences` in `apps/malini/src/lib/chat/domain/video-preferences.ts` holds `muted`, `volume` and `speed`, one of `VIDEO_SPEEDS` (1, 0.5, 0.25), and starts muted at full volume and 1×.
  `parseVideoPreferences` falls back field by field on anything it cannot trust, and `nextVideoSpeed` cycles the speeds.
- `video-preferences.store.svelte.ts` keeps them in `localStorage` under `malini.chat.video-preferences:v1`.
  `videoPreferencesQuery` reads them and `chooseVideoPreferencesCommand` changes them.
- `VideoPlayer.svelte` sets `muted`, `volume`, `defaultPlaybackRate` and `playbackRate` on its element from the preferences, and never binds them, so a load or a reset of the element never writes back.
  `VideoVolume.svelte` only reports a change, and the speed button dispatches the next speed.
- A report recording autoplays on a loop, so it stays silent until the user touches it: a click on it, play, the volume controls or **Maximize**.
  A player in `ImageGallery` takes `audible` and plays with the shared sound from the start.
- A click on a recording plays or pauses it.
  `VideoPlayer` covers its picture with a button named `Play <label>` or `Pause <label>`, and `VideoCompare` with one named **Play the recordings** or **Pause the recordings**, both out of the tab order beside the existing controls.
  **Maximize** is the only way from a report recording to the gallery; a report picture still opens it.
- `VideoCompare.svelte` plays at the shared speed and stays muted.
- `MediaGallery.svelte` opens an image or a video in `ImageGallery` over the shown images and videos, each named by its path under `.context`, since many takes share a name such as `clip.mp4`.
  A page or a document closes the gallery and opens in a new inspector browser tab at `worktreePageUrl`.
- A Media tile loads from `workstreamImageUrl` versioned by `modifiedAt`, an image or page still with `loading="lazy"`, and a video tile shows its first frame under a play badge without playing.
  A page tile shows `pageStillUrl`.
- `MediaViewer.svelte` and `WorkstreamMedia.svelte` are deleted.

## Consequences

Sound and speed set on any recording hold for every recording in Malini and after a restart.
A report with several recordings never plays sound the user did not ask for.
The Media gallery opens in about 0.2 s on the same 960 files, and its viewer is the chat's gallery, with its strip, zoom and video controls.
A page opens in a browser tab instead of a frame in the viewer, so it runs with the browser's tools and the variants strip.
What must stay true: no player binds `muted`, `volume` or `playbackRate` to its element, and a click on a recording never opens the gallery.
`apps/malini/src/lib/chat/domain/video-preferences.test.ts` covers the parsing and the speed cycle.
`apps/malini/tests/e2e/report-media.spec.ts` covers a click that plays or pauses a recording and both recordings of a before and after, sound and speed carried to another recording and kept after a reload, and the handoff through **Maximize**.
`apps/malini/tests/e2e/media-gallery.spec.ts` covers an image and a video in `ImageGallery`, and a page and a document in a browser tab.
