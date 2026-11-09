import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	accessSync,
	constants,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GH_DOWNLOAD_URL, GH_SHA256, GH_VERSION, installGh, verifySha256 } from './gh-install';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), 'malini-gh-install-'));
	roots.push(root);
	return root;
}

function releaseZip(): Uint8Array {
	const root = scratch();
	const asset = join(root, `gh_${GH_VERSION}_macOS_arm64`);
	mkdirSync(join(asset, 'bin'), { recursive: true });
	writeFileSync(join(asset, 'bin', 'gh'), '#!/bin/sh\necho gh\n');
	writeFileSync(join(asset, 'LICENSE'), 'MIT');
	execFileSync('ditto', ['-c', '-k', '--keepParent', asset, join(root, 'gh.zip')]);
	return new Uint8Array(readFileSync(join(root, 'gh.zip')));
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('installGh', () => {
	it('accepts a download only when its sha256 matches the pinned one', () => {
		const bytes = new TextEncoder().encode('gh');
		expect(() => verifySha256(bytes, sha256(bytes))).not.toThrow();
		expect(() => verifySha256(bytes, GH_SHA256)).toThrow(/expected da922c20/u);
	});

	it('puts the pinned gh in place once, runnable, and downloads nothing when it is there', async () => {
		const zip = releaseZip();
		const vendor = join(scratch(), 'vendor', 'gh');
		const asked: string[] = [];
		const download = (url: string): Promise<Response> => {
			asked.push(url);
			return Promise.resolve(new Response(zip));
		};

		await installGh(vendor, download, sha256(zip));
		await installGh(vendor, download, sha256(zip));

		expect(asked).toEqual([GH_DOWNLOAD_URL]);
		expect(() => accessSync(join(vendor, 'bin', 'gh'), constants.X_OK)).not.toThrow();
		expect(readFileSync(join(vendor, 'VERSION'), 'utf8')).toBe(`${GH_VERSION}\n`);
	});

	it('names the stage that failed and leaves no half-installed gh behind', async () => {
		const zip = releaseZip();
		const vendor = join(scratch(), 'vendor', 'gh');

		await expect(
			installGh(vendor, () => Promise.resolve(new Response('', { status: 404 })), sha256(zip)),
		).rejects.toMatchObject({
			name: 'GhInstallError',
			kind: 'download',
			message: 'Could not download the GitHub CLI: HTTP 404',
		});
		await expect(
			installGh(vendor, () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED')), sha256(zip)),
		).rejects.toMatchObject({ kind: 'download', message: /ERR_NAME_NOT_RESOLVED/u });
		await expect(installGh(vendor, () => Promise.resolve(new Response(zip)))).rejects.toMatchObject(
			{
				kind: 'checksum',
			},
		);
		const broken = new TextEncoder().encode('not a zip');
		await expect(
			installGh(vendor, () => Promise.resolve(new Response(broken)), sha256(broken)),
		).rejects.toMatchObject({ kind: 'unpack' });

		expect(readdirSync(dirname(vendor))).toEqual([]);
	});
});
