import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wheels } from '../src/lib/odometer.ts';

const METERS = [
	[1_284_019, 7_800],
	[92_410, 520],
] as const;

test('the meter starts on its number, every wheel on a whole face', () => {
	for (const [from, rate] of METERS) {
		const start = wheels(from, rate, 0);
		assert.equal(start.join(''), String(from));
	}
});

test('every wheel turns forward, less than half a face a frame, and never jumps', () => {
	for (const [from, rate] of METERS) {
		let before = wheels(from, rate, 0);
		for (let frame = 1; frame <= 60 * 120; frame++) {
			const after = wheels(from, rate, frame / 60);
			before.toReversed().forEach((position, place) => {
				const turn = ((after.at(-1 - place) ?? 0) - position + 10) % 10;
				assert.ok(turn < 0.5, `wheel ${place} of ${from} turned ${turn} faces at frame ${frame}`);
			});
			before = after;
		}
	}
});
