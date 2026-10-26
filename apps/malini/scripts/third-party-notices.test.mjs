import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import test from 'node:test';

import { noticesFor, unlistedIn } from './third-party-notices.mjs';

const require = createRequire(import.meta.url);

test('each bundled npm package appears once with its license text, and our own code never does', () => {
	const svelte = require.resolve('svelte');
	const geist = require.resolve('@fontsource-variable/geist/wght.css');
	const notices = noticesFor([
		svelte,
		`\0${svelte}?commonjs-proxy`,
		geist,
		'/repo/packages/hyper-ui/src/components/button/index.ts',
		'\0vite/preload-helper.js',
	]);

	assert.equal(notices.match(/^svelte@/gmu)?.length, 1);
	assert.match(notices, /^@fontsource-variable\/geist@\S+\n\nLicense: OFL-1.1\n/mu);
	assert.match(notices, /SIL OPEN FONT LICENSE/u);
	assert.doesNotMatch(notices, /hyper-ui|preload-helper/u);
});

test('NOTICE must list every bundled npm package by name at the start of a line', () => {
	const ids = [require.resolve('svelte'), require.resolve('@fontsource-variable/geist/wght.css')];
	assert.deepEqual(unlistedIn('svelte (MIT): Svelte Contributors\n', ids), [
		'@fontsource-variable/geist',
	]);
	assert.deepEqual(unlistedIn('a svelte\n@fontsource-variable/geist (OFL-1.1)\n', ids), ['svelte']);
});
