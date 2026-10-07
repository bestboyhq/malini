import { describe, expect, it } from 'vitest';
import {
	createScrollGlide,
	SCROLL_GLIDE_SETTLE_PX,
	SCROLL_SPRING_STIFFNESS,
	stepGlideSpring,
	type GlideState,
} from './scroll-glide';

const FRAME_MS = 1000 / 60;
const AT_REST: GlideState = { position: 0, velocity: 0 };

function stepAt(steps: readonly number[], index: number): number {
	const step = steps[index];
	if (step === undefined) throw new Error(`expected a step at index ${index}`);
	return step;
}

function replay(distance: number, samplesMs: readonly number[]): number[] {
	let state = AT_REST;
	let elapsed = 0;
	const wanted = [...samplesMs].sort((a, b) => a - b);
	const out: number[] = [];
	let index = 0;
	while (index < wanted.length && elapsed < 5_000) {
		elapsed += FRAME_MS;
		state = stepGlideSpring(state, distance, FRAME_MS);
		while (index < wanted.length && elapsed >= (wanted[index] ?? Infinity)) {
			out.push(state.position / distance);
			index += 1;
		}
	}
	return out;
}

function settleMs(distance: number): number {
	let state = AT_REST;
	let elapsed = 0;
	while (state.position !== distance && elapsed < 5_000) {
		elapsed += FRAME_MS;
		state = stepGlideSpring(state, distance, FRAME_MS);
	}
	return elapsed;
}

describe('glide curve', () => {
	it('is most of the way there while the arriving row is still travelling', () => {
		const [at150, at270, at400] = replay(41.5, [150, 270, 400]);
		expect(at150).toBeGreaterThan(0.55);
		expect(at270).toBeGreaterThan(0.88);
		expect(at400).toBeGreaterThan(0.97);
	});

	it('starts from rest, accelerates, then decelerates', () => {
		let state = AT_REST;
		const steps: number[] = [];
		for (let frame = 0; frame < 30; frame += 1) {
			const next = stepGlideSpring(state, 400, FRAME_MS);
			if (next.position === 400) break;
			steps.push(next.position - state.position);
			state = next;
		}
		const peak = steps.indexOf(Math.max(...steps));
		expect(peak).toBeGreaterThan(0);
		for (let index = 1; index <= peak; index += 1) {
			expect(steps[index]).toBeGreaterThan(stepAt(steps, index - 1));
		}
		for (let index = peak + 1; index < steps.length; index += 1) {
			expect(steps[index]).toBeLessThan(stepAt(steps, index - 1));
		}
	});

	it('never goes past its target', () => {
		let state = AT_REST;
		for (let frame = 0; frame < 300; frame += 1) {
			state = stepGlideSpring(state, 400, FRAME_MS);
			expect(state.position).toBeLessThanOrEqual(400);
		}
	});

	it('carries velocity through a retarget instead of re-easing from a standstill', () => {
		let state = AT_REST;
		for (let frame = 0; frame < 6; frame += 1) state = stepGlideSpring(state, 200, FRAME_MS);
		const moving = stepGlideSpring(state, 400, FRAME_MS).position - state.position;
		const fromRest = stepGlideSpring(
			{ position: state.position, velocity: 0 },
			400,
			FRAME_MS,
		).position;
		expect(moving).toBeGreaterThan(fromRest - state.position);
	});

	it('lands one row in about a third of a second and a screenful in under half a second', () => {
		expect(settleMs(41.5)).toBeGreaterThan(250);
		expect(settleMs(41.5)).toBeLessThan(350);
		expect(settleMs(400)).toBeGreaterThan(400);
		expect(settleMs(400)).toBeLessThan(500);
	});

	it('travels the same curve upwards', () => {
		const down = stepGlideSpring(AT_REST, 400, FRAME_MS);
		const up = stepGlideSpring({ position: 400, velocity: 0 }, 0, FRAME_MS);
		expect(up.position).toBeCloseTo(400 - down.position, 6);
		expect(up.velocity).toBeCloseTo(-down.velocity, 6);
	});

	it('stays stable on a slow display rather than gaining energy', () => {
		let state = AT_REST;
		for (let frame = 0; frame < 60; frame += 1) state = stepGlideSpring(state, 400, 1000 / 30);
		expect(state.position).toBe(400);
	});
});

describe('glide arrival', () => {
	it('snaps once the remainder is smaller than a pixel can show', () => {
		const state = { position: 100, velocity: 0 };
		expect(stepGlideSpring(state, 100 + SCROLL_GLIDE_SETTLE_PX, FRAME_MS).position).toBe(
			100 + SCROLL_GLIDE_SETTLE_PX,
		);
		expect(stepGlideSpring(AT_REST, 0.4, FRAME_MS).position).toBe(0.4);
	});

	it('does not settle while it is still moving quickly through the target', () => {
		const fast = { position: 399.8, velocity: 600 };
		const stepped = stepGlideSpring(fast, 400, FRAME_MS);
		expect(stepped.velocity).not.toBe(0);
	});

	it('arrives rather than crawls when the window was occluded for a second', () => {
		expect(stepGlideSpring(AT_REST, 900, 1_000)).toEqual({ position: 900, velocity: 0 });
	});

	it('picks up where it was after the page stalls for a few frames, instead of jumping', () => {
		const stepped = stepGlideSpring(AT_REST, 900, 300);
		expect(stepped.position).toBeGreaterThan(0);
		expect(stepped.position).toBeLessThan(200);
	});

	it('holds position for a zero-length frame', () => {
		const state = { position: 120, velocity: 40 };
		expect(stepGlideSpring(state, 400, 0)).toBe(state);
	});

	it('gives up on a non-finite input rather than writing NaN into scrollTop', () => {
		expect(stepGlideSpring({ position: Number.NaN, velocity: 0 }, 400, FRAME_MS).position).toBe(
			400,
		);
		expect(stepGlideSpring(AT_REST, 400, Number.NaN).position).toBe(400);
		expect(stepGlideSpring(AT_REST, 400, FRAME_MS, 0).position).toBe(400);
	});
});

function testScheduler() {
	let now = 0;
	let nextHandle = 1;
	const pending = new Map<number, (timestampMs: number) => void>();
	return {
		requestFrame(callback: (timestampMs: number) => void): number {
			const handle = nextHandle;
			nextHandle += 1;
			pending.set(handle, callback);
			return handle;
		},
		cancelFrame(handle: number): void {
			pending.delete(handle);
		},
		advance(ms: number): void {
			now += ms;
			const due = [...pending.entries()];
			pending.clear();
			for (const [, callback] of due) callback(now);
		},
		get pendingCount(): number {
			return pending.size;
		},
	};
}

describe('glide driver', () => {
	it('moves the element toward the target across frames and then stops asking for more', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 0 };

		glide.glide(element, 400);
		expect(element.scrollTop).toBe(0);

		scheduler.advance(FRAME_MS);
		expect(element.scrollTop).toBe(0);

		scheduler.advance(FRAME_MS);
		expect(element.scrollTop).toBeGreaterThan(5);
		expect(element.scrollTop).toBeLessThan(25);

		for (let frame = 0; frame < 120 && glide.isGliding; frame += 1) scheduler.advance(FRAME_MS);
		expect(element.scrollTop).toBe(400);
		expect(glide.isGliding).toBe(false);
		expect(scheduler.pendingCount).toBe(0);
	});

	it('retargets a streaming response without re-easing from a standstill', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 0 };

		glide.glide(element, 200);
		scheduler.advance(FRAME_MS);
		scheduler.advance(FRAME_MS);
		const afterFirstStep = element.scrollTop;

		glide.glide(element, 400);
		scheduler.advance(FRAME_MS);
		const afterRetarget = element.scrollTop - afterFirstStep;

		expect(afterRetarget).toBeGreaterThan(0);
		expect(glide.isGliding).toBe(true);
	});

	it('lets a jump cut the glide off and land exactly', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 0 };

		glide.glide(element, 400);
		scheduler.advance(FRAME_MS);
		scheduler.advance(FRAME_MS);
		glide.jump(element, 900);

		expect(element.scrollTop).toBe(900);
		expect(glide.isGliding).toBe(false);
		expect(scheduler.pendingCount).toBe(0);
	});

	it('hands the scroll back the moment it is cancelled', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 0 };

		glide.glide(element, 400);
		scheduler.advance(FRAME_MS);
		scheduler.advance(FRAME_MS);
		const releasedAt = element.scrollTop;
		glide.cancel();
		scheduler.advance(FRAME_MS * 10);

		expect(element.scrollTop).toBe(releasedAt);
		expect(glide.isGliding).toBe(false);
	});

	it('starts nothing when the column is already where it should be', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 400 };

		glide.glide(element, 400.2);

		expect(element.scrollTop).toBe(400.2);
		expect(glide.isGliding).toBe(false);
		expect(scheduler.pendingCount).toBe(0);
	});

	it('reads the element once per aim and never once per frame', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		let reads = 0;
		let stored = 0;
		const element = {
			get scrollTop(): number {
				reads += 1;
				return stored;
			},
			set scrollTop(value: number) {
				stored = value;
			},
		};

		glide.glide(element, 400);
		expect(reads).toBe(1);

		for (let frame = 0; frame < 60 && glide.isGliding; frame += 1) scheduler.advance(FRAME_MS);

		expect(stored).toBe(400);
		expect(reads).toBe(1);
	});

	it('re-reads the element when a new target is aimed, so a clamped write cannot drift', () => {
		const scheduler = testScheduler();
		const glide = createScrollGlide(scheduler);
		const element = { scrollTop: 0 };

		glide.glide(element, 400);
		scheduler.advance(FRAME_MS);
		scheduler.advance(FRAME_MS);
		element.scrollTop = 900;
		glide.glide(element, 1_000);
		for (let frame = 0; frame < 60 && glide.isGliding; frame += 1) scheduler.advance(FRAME_MS);

		expect(element.scrollTop).toBe(1_000);
	});

	it('exposes the constant the transcript is tuned against', () => {
		expect(SCROLL_SPRING_STIFFNESS).toBe(420);
	});

	it('reads its stiffness per frame, so the spring can be retuned mid-conversation', () => {
		const scheduler = testScheduler();
		let stiffness = SCROLL_SPRING_STIFFNESS;
		const glide = createScrollGlide({ ...scheduler, stiffness: () => stiffness });
		const element = { scrollTop: 0 };

		glide.glide(element, 4_000);
		scheduler.advance(FRAME_MS);
		scheduler.advance(FRAME_MS);
		const soft = element.scrollTop;

		stiffness = SCROLL_SPRING_STIFFNESS * 4;
		scheduler.advance(FRAME_MS);
		const stiff = element.scrollTop - soft;

		expect(stiff).toBeGreaterThan(soft);
	});
});
