import assert from 'node:assert/strict';
import { test } from 'node:test';
import { easeOut } from '../src/lib/menu.ts';

test('menus ease out on the site curve: pinned ends, always rising, steep at the start', () => {
	assert.equal(easeOut(0), 0);
	assert.equal(easeOut(1), 1);
	let previous = 0;
	for (let step = 1; step <= 100; step++) {
		const progress = easeOut(step / 100);
		assert.ok(progress >= previous, `falls at ${step}%`);
		previous = progress;
	}
	assert.ok(easeOut(0.2) > 0.6);
	assert.ok(Math.abs(easeOut(0.5) - 0.961) < 0.005);
});
