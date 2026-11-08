import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRIP, spring } from '../src/lib/loupe.ts';

const FRAME = 1_000 / 60;
const FLICK = 150;
const SPEED = 4;
const END = FLICK * SPEED;

test('the loupe keeps up with a flicked pointer, never outruns it and never passes it', () => {
	const pos = { x: 0, y: 0 };
	const vel = { x: 0, y: 0 };
	let settled = Infinity;
	for (let t = FRAME; t < 1_000; t += FRAME) {
		const last = pos.x;
		spring(pos, vel, { x: Math.min(t, FLICK) * SPEED, y: 0 }, GRIP, FRAME);
		assert.ok(pos.x - last <= SPEED * FRAME, `jumps ${(pos.x - last).toFixed(1)} px in a frame`);
		assert.ok(pos.x <= END, `passes the pointer by ${(pos.x - END).toFixed(1)} px`);
		if (t > FLICK && END - pos.x < 2) settled = Math.min(settled, t - FLICK);
	}
	assert.ok(settled < 250, `settles ${settled.toFixed(0)} ms after the pointer stops`);
});
