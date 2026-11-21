import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hold } from '../scripts/readme-hero.ts';

const WIDTH = 16;
const at = (x: number, y: number): number => (y * WIDTH + x) * 4;

test('the README hero moves a whole block or keeps it until the encoder would see it move', () => {
	const shown = Buffer.alloc(WIDTH * WIDTH * 4);
	const frame = Buffer.from(shown);
	frame[at(0, 0)] = 200;
	frame[at(7, 7) + 1] = 2;
	frame[at(8, 0)] = 2;
	frame[at(9, 9) + 2] = 2;
	hold(shown, frame, WIDTH, 78);
	const expected = Buffer.alloc(shown.length);
	expected[at(0, 0)] = 200;
	expected[at(7, 7) + 1] = 2;
	assert.deepEqual(shown, expected);
	hold(shown, frame, WIDTH, 97);
	assert.deepEqual(shown, frame);
});
