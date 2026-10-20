import { describe, expect, it } from 'vitest';
import { indexFileMentionPaths, resolveFileMention } from './file-mention-index';

const index = indexFileMentionPaths([
	'remote.ts',
	'src/git/remote.ts',
	'src/git/credentials.ts',
	'apps/malini/src/clone.service.ts',
	'packages/a/index.ts',
	'packages/b/index.ts',
]);

describe('finding the file a chat message names', () => {
	it('takes the file at exactly that path even when deeper files share its name', () => {
		expect(resolveFileMention(index, { path: 'remote.ts', line: null })).toEqual([
			{ path: 'remote.ts', line: null },
		]);
	});

	it('finds the one file whose path ends with the name the message used', () => {
		expect(resolveFileMention(index, { path: 'credentials.ts', line: null })).toEqual([
			{ path: 'src/git/credentials.ts', line: null },
		]);
		expect(resolveFileMention(index, { path: 'src/clone.service.ts', line: null })).toEqual([
			{ path: 'apps/malini/src/clone.service.ts', line: null },
		]);
	});

	it('offers every file a shared name could mean', () => {
		expect(resolveFileMention(index, { path: 'index.ts', line: null })).toEqual([
			{ path: 'packages/a/index.ts', line: null },
			{ path: 'packages/b/index.ts', line: null },
		]);
	});

	it('finds nothing for a name no file has', () => {
		expect(resolveFileMention(index, { path: 'ghost.ts', line: null })).toEqual([]);
		expect(resolveFileMention(index, { path: 'lib/remote.ts', line: null })).toEqual([]);
	});

	it('keeps the line the message pointed at', () => {
		expect(resolveFileMention(index, { path: 'credentials.ts', line: 42 })).toEqual([
			{ path: 'src/git/credentials.ts', line: 42 },
		]);
		expect(resolveFileMention(index, { path: 'index.ts', line: 7 })).toEqual([
			{ path: 'packages/a/index.ts', line: 7 },
			{ path: 'packages/b/index.ts', line: 7 },
		]);
	});

	it('matches whole path segments only', () => {
		expect(resolveFileMention(index, { path: 'ote.ts', line: null })).toEqual([]);
		expect(resolveFileMention(index, { path: 'it/remote.ts', line: null })).toEqual([]);
		expect(resolveFileMention(index, { path: 'service.ts', line: null })).toEqual([]);
	});
});
