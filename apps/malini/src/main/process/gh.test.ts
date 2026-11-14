import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ghEnvironment, runGh, withBundledGh } from './gh';
import { fakeTool } from './test-support';

const path = (...directories: string[]): string => directories.join(delimiter);

describe('withBundledGh', () => {
	it('puts the gh malini ships after every directory on the PATH, so a user’s own gh wins', () => {
		const resources = '/Applications/malini.app/Contents/Resources';
		expect(withBundledGh(path('/opt/homebrew/bin', '/usr/bin'), resources)).toBe(
			path('/opt/homebrew/bin', '/usr/bin', join(resources, 'vendor', 'gh', 'bin')),
		);
		expect(withBundledGh(undefined, '/resources')).toBe(join('/resources', 'vendor', 'gh', 'bin'));
	});

	it('puts the gh setup installs last, after the one malini ships', () => {
		expect(withBundledGh('/usr/bin', '/resources', '/app-data')).toBe(
			path(
				'/usr/bin',
				join('/resources', 'vendor', 'gh', 'bin'),
				join('/app-data', 'vendor', 'gh', 'bin'),
			),
		);
	});
});

describe('runGh', () => {
	it('stops a gh that does not answer in time and says GitHub did not answer', async () => {
		const bin = mkdtempSync(join(tmpdir(), 'malini-gh-'));
		try {
			fakeTool(join(bin, 'gh'), '#!/bin/sh\nexec sleep 30\n');
			const env = ghEnvironment({ ...process.env, HOME: bin, MALINI_GH_PATH: path(bin, '/bin') });

			await expect(runGh(['auth', 'status'], { env, timeoutMs: 2_000 })).rejects.toMatchObject({
				name: 'GhError',
				kind: 'unreachable',
				message: 'GitHub did not answer in 2 seconds.',
			});
			await expect(
				runGh(['auth', 'status'], { env: ghEnvironment({ MALINI_GH_PATH: join(bin, 'missing') }) }),
			).rejects.toMatchObject({ kind: 'not-installed' });
		} finally {
			rmSync(bin, { recursive: true, force: true, maxRetries: 10 });
		}
	});
});
