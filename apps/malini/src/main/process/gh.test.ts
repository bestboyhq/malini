import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ghEnvironment, runGh, withBundledGh } from './gh';

describe('withBundledGh', () => {
	it('puts the gh malini ships after every directory on the PATH, so a user’s own gh wins', () => {
		expect(
			withBundledGh('/opt/homebrew/bin:/usr/bin', '/Applications/malini.app/Contents/Resources'),
		).toBe('/opt/homebrew/bin:/usr/bin:/Applications/malini.app/Contents/Resources/vendor/gh/bin');
		expect(withBundledGh(undefined, '/resources')).toBe('/resources/vendor/gh/bin');
	});

	it('puts the gh setup installs last, after the one malini ships', () => {
		expect(withBundledGh('/usr/bin', '/resources', '/app-data')).toBe(
			'/usr/bin:/resources/vendor/gh/bin:/app-data/vendor/gh/bin',
		);
	});
});

describe('runGh', () => {
	it('stops a gh that does not answer in time and says GitHub did not answer', async () => {
		const bin = mkdtempSync(join(tmpdir(), 'malini-gh-'));
		try {
			writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexec sleep 30\n');
			chmodSync(join(bin, 'gh'), 0o755);
			const env = ghEnvironment({ HOME: bin, MALINI_GH_PATH: `${bin}:/bin` });

			await expect(runGh(['auth', 'status'], { env, timeoutMs: 2_000 })).rejects.toMatchObject({
				name: 'GhError',
				kind: 'unreachable',
				message: 'GitHub did not answer in 2 seconds.',
			});
			await expect(
				runGh(['auth', 'status'], { env: ghEnvironment({ MALINI_GH_PATH: '/bin' }) }),
			).rejects.toMatchObject({ kind: 'not-installed' });
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	});
});
