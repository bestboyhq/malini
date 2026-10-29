import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraFor, shotOf } from '../src/lib/camera.ts';

const app = { width: 1280, height: 860 };
const stage = { width: 640, height: 480 };

test('the camera fits the whole app without a shot', () => {
	const camera = cameraFor(app, stage, null);
	assert.equal(camera.scale, 0.5);
	assert.equal(camera.x, 0);
	assert.equal(camera.y, (480 - 430) / 2);
});

test('the camera frames a shot and never shows past the app edge', () => {
	const sidebar = cameraFor(app, stage, { x: 0, y: 0, width: 320, height: 250 });
	assert.equal(sidebar.scale, 1.5);
	assert.equal(sidebar.x, 0);
	assert.equal(sidebar.y, 0);
	const corner = cameraFor(app, stage, { x: 1180, y: 760, width: 100, height: 100 });
	assert.equal(corner.x, 640 - 1280 * 1.5);
	assert.equal(corner.y, 480 - 860 * 1.5);
});

test('a shot from the frame must be four finite numbers with a size', () => {
	assert.deepEqual(shotOf({ x: 1, y: 2, width: 3, height: 4 }), {
		x: 1,
		y: 2,
		width: 3,
		height: 4,
	});
	assert.equal(shotOf({ x: 1, y: 2, width: 0, height: 4 }), null);
	assert.equal(shotOf({ x: '1', y: 2, width: 3, height: 4 }), null);
	assert.equal(shotOf(null), null);
});
