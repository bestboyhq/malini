import { describe, expect, it } from 'vitest';
import { relativizeWorkstreamPath } from './workstream-path';

describe('relativizeWorkstreamPath', () => {
	it('strips workstreams checkout prefixes for display', () => {
		expect(
			relativizeWorkstreamPath(
				'/Users/me/Library/Application Support/com.malini.app/workstreams/01JABC/src/server.js',
			),
		).toBe('src/server.js');
	});

	it('keeps legacy checkout prefixes supported', () => {
		expect(
			relativizeWorkstreamPath(
				'/Users/me/Library/Application Support/com.malini.app/worktrees/01JABC/src/server.js',
			),
		).toBe('src/server.js');
	});
});
