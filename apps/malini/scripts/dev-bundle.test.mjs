import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bundleStamp, isStale, urlSchemes } from './dev-bundle.mjs';

test('Malini.app is rebuilt when it is missing, or Electron or the icon changed', (t) => {
	const dist = mkdtempSync(join(tmpdir(), 'malini-dev-bundle-'));
	t.after(() => rmSync(dist, { recursive: true, force: true }));
	const icon = join(dist, 'icon.png');
	writeFileSync(join(dist, 'version'), '44.4.0');
	writeFileSync(icon, 'malini');
	assert.equal(isStale(dist, bundleStamp(dist, icon)), true);

	mkdirSync(join(dist, 'Malini.app/Contents/MacOS'), { recursive: true });
	writeFileSync(join(dist, 'Malini.app/Contents/MacOS/Electron'), '');
	writeFileSync(join(dist, 'Malini.app.stamp'), bundleStamp(dist, icon));
	assert.equal(isStale(dist, bundleStamp(dist, icon)), false);

	writeFileSync(join(dist, 'version'), '45.0.0');
	assert.equal(isStale(dist, bundleStamp(dist, icon)), true);

	writeFileSync(join(dist, 'version'), '44.4.0');
	writeFileSync(icon, 'malini, redrawn');
	assert.equal(isStale(dist, bundleStamp(dist, icon)), true);
});

test('only the dogfood Malini.app declares malini://, and switching rebuilds it', (t) => {
	const dist = mkdtempSync(join(tmpdir(), 'malini-dev-bundle-'));
	t.after(() => rmSync(dist, { recursive: true, force: true }));
	const icon = join(dist, 'icon.png');
	writeFileSync(join(dist, 'version'), '44.4.0');
	writeFileSync(icon, 'malini');
	assert.deepEqual(urlSchemes({ MALINI_DOGFOOD: '1' }), ['malini']);
	assert.deepEqual(urlSchemes({}), []);
	assert.notEqual(bundleStamp(dist, icon, ['malini']), bundleStamp(dist, icon, []));
});
