# 0189 - The hero loupe keeps up with the pointer

Status: accepted

## Context

0188 had the loupe follow the pointer on the steps' spring of stiffness 40, and `loupe.ts` held it within 0.6 of its radius of the pointer, a leash no ADR named.
The user found: "when I move my cursor around the hero section, the loupe follows kinda slowly. And if I move my cursor very quickly, the loupe jumps."
Measured in an offscreen Electron window at 60 frames a second, the loupe took 780 to 870 ms to settle after the pointer stopped.
Past about 300 px/s that spring fell behind to the leash, and the leash moved the loupe in its place: from almost still to 85 px in one frame on a 4000 px/s flick, and up to 175 px in one frame when the pointer turned.
The spring of stiffness 40 stays right for the steps and for the glide home: after a fast exit it coasts to where the pointer left, where a stiff spring stops it dead.

## Decision

- This replaces 0188's "It follows the pointer on that spring alone, with no lead"; the rest of 0188 holds.
- While the pointer is over the stage, `apps/site/src/lib/loupe.ts` follows it on a critically damped spring of stiffness 1600, `GRIP`, with no leash.
- When the pointer comes onto the stage, the spring's target glides from the loupe to the pointer on a 600 ms smoothstep, `CATCH`, so the loupe does not dart across the stage.
- The steps, and the glide home once the pointer leaves, stay on the spring of stiffness 40 under the 1.8 s smoothstep.
- Both use one pure integrator, `spring` in `loupe.ts`.

## Consequences

- The loupe settles 120 to 150 ms after the pointer stops.
  On a 3000 px/s zigzag its velocity changes by at most 1400 px/s in a frame, against 3240 px/s with the leash.
- A critically damped spring never moves faster than its target and never passes it, so the loupe cannot jump ahead of the pointer.
- Above about 2500 px/s the pointer reaches the rim of a 128 px loupe for a moment, and the loupe catches up without a jump.
- A loupe that glides to a step when the pointer arrives stops in a few frames, then turns to the pointer.
- `apps/site/tests/loupe.test.ts` flicks a pointer at 4000 px/s for 150 ms.
  It fails when the loupe moves farther than the pointer in a frame, passes it, or needs 250 ms or more to settle within 2 px, and it fails on stiffness 40.
  Nothing tests the catch glide or that the leash stays gone.
- The loupe's code is in the Open Graph view's source hash, so this change re-rendered `og.png`, byte for byte the same, and rewrote `og-source.sha256`.
