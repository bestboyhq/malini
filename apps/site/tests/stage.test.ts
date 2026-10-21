import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGE_LIGHTING, stageFallback } from '../src/lib/stage/domain/stage-lighting.ts';

test('the CSS fallback lights the same spot and floor as the shader', () => {
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
});
