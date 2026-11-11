import { createHash } from 'node:crypto';
import { accessSync, constants, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallProgressPayload } from '$contract/events';
import { installClaudeCode } from './claude-install';

const RELEASES = 'https://downloads.example.invalid/claude-code-releases';
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), 'malini-claude-install-'));
	roots.push(root);
	return root;
}

function installer(body: string): Uint8Array {
	return new TextEncoder().encode(`#!/bin/sh\n[ "$1 $2" = "install 9.9.9" ] || exit 2\n${body}\n`);
}

const INSTALLS_LAUNCHER = installer(
	'[ -x "$HOME/.local/share/claude/versions/9.9.9" ] || { echo "no build to reuse" >&2; exit 1; }\nmkdir -p "$HOME/.local/bin" && ln -s "$HOME/.local/share/claude/versions/9.9.9" "$HOME/.local/bin/claude"',
);

function release(
	binary: Uint8Array,
	{ latest = '9.9.9\n', checksum = sha256(binary) }: { latest?: string; checksum?: string } = {},
) {
	const files: Record<string, string | Uint8Array> = {
		[`${RELEASES}/latest`]: latest,
		[`${RELEASES}/9.9.9/manifest.json`]: JSON.stringify({
			version: '9.9.9',
			platforms: { 'darwin-arm64': { binary: 'claude', checksum, size: binary.byteLength } },
		}),
		[`${RELEASES}/9.9.9/darwin-arm64/claude`]: binary,
	};
	return (url: string): Promise<Response> => {
		const body = files[url];
		return Promise.resolve(
			body === undefined ? new Response('', { status: 404 }) : new Response(body),
		);
	};
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function options(
	fetch: (url: string) => Promise<Response>,
	progress: InstallProgressPayload[] = [],
) {
	const home = scratch();
	const directory = join(scratch(), 'claude-setup');
	return {
		home,
		directory,
		install: {
			fetch,
			directory,
			environment: { HOME: home, PATH: '/usr/bin:/bin' },
			onProgress: (p: InstallProgressPayload) => progress.push(p),
			releases: RELEASES,
		},
	};
}

describe('installClaudeCode', () => {
	it('downloads the latest build with progress, checks it, hands it to its own installer and leaves no download behind', async () => {
		const progress: InstallProgressPayload[] = [];
		const { home, directory, install } = options(release(INSTALLS_LAUNCHER), progress);

		await installClaudeCode(install);

		expect(() => accessSync(join(home, '.local', 'bin', 'claude'), constants.X_OK)).not.toThrow();
		expect(
			readFileSync(join(home, '.local', 'share', 'claude', 'versions', '9.9.9')).equals(
				INSTALLS_LAUNCHER,
			),
		).toBe(true);
		const size = INSTALLS_LAUNCHER.byteLength;
		expect(progress.at(0)).toEqual({ received: 0, total: size });
		expect(progress.at(-1)).toEqual({ received: size, total: size });
		expect(readdirSync(directory)).toEqual([]);
	});

	it('names the stage that failed and leaves no download behind', async () => {
		const offline = options(() => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED')));
		await expect(installClaudeCode(offline.install)).rejects.toMatchObject({
			name: 'ClaudeInstallError',
			kind: 'download',
			message: 'Could not download Claude Code: net::ERR_NAME_NOT_RESOLVED',
		});

		const blocked = options(release(INSTALLS_LAUNCHER, { latest: '<html>Not available</html>' }));
		await expect(installClaudeCode(blocked.install)).rejects.toMatchObject({
			kind: 'download',
			message:
				'Could not download Claude Code: downloads.claude.ai sent no version: <html>Not available</html>',
		});

		const tampered = options(release(INSTALLS_LAUNCHER, { checksum: 'a'.repeat(64) }));
		await expect(installClaudeCode(tampered.install)).rejects.toMatchObject({ kind: 'checksum' });
		expect(readdirSync(tampered.directory)).toEqual([]);
		expect(readdirSync(tampered.home)).toEqual([]);

		const full = options(release(installer('echo "No space left on device" >&2; exit 1')));
		await expect(installClaudeCode(full.install)).rejects.toMatchObject({
			kind: 'setup',
			message: 'Claude Code could not set itself up: No space left on device',
		});
		expect(readdirSync(full.directory)).toEqual([]);
	});
});
