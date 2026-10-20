import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGE_LIGHTING, stageFallback } from '../src/lib/stage/domain/stage-lighting.ts';

test('the CSS fallback lights the same spot and floor as the shader', () => {
	assert.deepEqual(stageFallback(STAGE_LIGHTING.hero), {
		spot: '50% 100%',
		spread: '56% 70%',
		floor: '180deg',
		floorFrom: '8%',
		floorTo: '100%',
	});
	assert.deepEqual(stageFallback(STAGE_LIGHTING.bottom), {
		spot: '50% 100%',
		spread: '60% 90%',
		floor: '180deg',
		floorFrom: '0%',
		floorTo: '100%',
	});
	const corners = { spread: '110% 130%', floorFrom: '0%', floorTo: '100%' };
	assert.deepEqual(stageFallback(STAGE_LIGHTING['bottom-left']), {
		...corners,
		spot: '0% 100%',
		floor: '225deg',
	});
	assert.deepEqual(stageFallback(STAGE_LIGHTING['bottom-right']), {
		...corners,
		spot: '100% 100%',
		floor: '135deg',
	});
	assert.deepEqual(stageFallback(STAGE_LIGHTING['top-left']), {
		...corners,
		spot: '0% 0%',
		floor: '315deg',
	});
});
