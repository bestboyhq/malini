import assert from 'node:assert/strict';
import test from 'node:test';
import { fileIconIdFor, folderIconIdFor } from '@malini/extension-api';
import { repositoryTreeIconIds } from '../src/tree-icons.js';

test('names the icons of the rows a fresh tree shows, one level deep, and nothing deeper', () => {
	const ids = repositoryTreeIconIds([
		'README.md',
		'docs/guide.md',
		'apps/malini/src/main.ts',
		'packages/ui/deep/very/deep.svelte',
	]);

	assert.deepEqual(
		new Set(ids),
		new Set([
			fileIconIdFor('README.md'),
			folderIconIdFor('docs', { expanded: false }),
			folderIconIdFor('docs', { expanded: true }),
			fileIconIdFor('docs/guide.md'),
			folderIconIdFor('apps', { expanded: false }),
			folderIconIdFor('apps', { expanded: true }),
			folderIconIdFor('apps/malini', { expanded: false }),
			folderIconIdFor('packages', { expanded: false }),
			folderIconIdFor('packages', { expanded: true }),
			folderIconIdFor('packages/ui', { expanded: false }),
		]),
	);
	assert.equal(ids.includes(fileIconIdFor('apps/malini/src/main.ts')), false);
	assert.equal(ids.includes(fileIconIdFor('packages/ui/deep/very/deep.svelte')), false);
});
