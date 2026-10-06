import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	buildFileIconAssets,
	formatModule,
	MAP_MODULE,
	readWrittenIconIds,
} from './generate-file-icons.mjs';

test('the committed icon map matches the installed material-icon-theme', async () => {
	const { module } = buildFileIconAssets();
	const formatted = await formatModule(module);
	const committed = readFileSync(MAP_MODULE, 'utf8');
	assert.equal(
		committed,
		formatted,
		'packages/extension-api/src/file-icons/material-icon-map.generated.ts is stale; run `node scripts/generate-file-icons.mjs`',
	);
});

test('every icon the map can resolve is on disk', () => {
	const { svgById } = buildFileIconAssets();
	const written = new Set(readWrittenIconIds());
	const missing = [...svgById.keys()].filter((id) => !written.has(id));
	assert.deepEqual(
		missing,
		[],
		'src/renderer/public/file-icons is missing icons the map references; run `node scripts/generate-file-icons.mjs`',
	);
});

test('no icon is on disk that nothing can resolve', () => {
	const { svgById } = buildFileIconAssets();
	const orphaned = readWrittenIconIds().filter((id) => !svgById.has(id));
	assert.deepEqual(
		orphaned,
		[],
		'src/renderer/public/file-icons carries icons the map never names; run `node scripts/generate-file-icons.mjs`',
	);
});

test('the vendored assets carry their license', () => {
	const license = readFileSync(
		new URL('../src/renderer/public/file-icons/LICENSE', import.meta.url),
		'utf8',
	);
	assert.match(license, /MIT/u);
});
