import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	accessSync,
	constants,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { installRtk, RTK_VERSION } from './fetch-rtk.mjs';

function release() {
	const root = mkdtempSync(join(tmpdir(), 'malini-fetch-rtk-'));
	writeFileSync(join(root, 'rtk'), '#!/bin/sh\necho rtk\n');
	writeFileSync(join(root, 'LICENSE'), 'Apache-2.0');
	execFileSync('tar', ['-czf', 'rtk.tar.gz', 'rtk', 'LICENSE'], { cwd: root });
	const archive = new Uint8Array(readFileSync(join(root, 'rtk.tar.gz')));
	const sha256 = createHash('sha256').update(archive).digest('hex');
	return { archive, build: { asset: 'rtk-oss-test.tar.gz', sha256 } };
}

test('puts the pinned rtk-oss build in place once, with its license and version', async () => {
	const { archive, build } = release();
	const vendor = join(mkdtempSync(join(tmpdir(), 'malini-vendor-')), 'rtk');
	/** @type {string[]} */
	const asked = [];
	const download = (/** @type {string} */ url) => {
		asked.push(url);
		return Promise.resolve(new Response(archive));
	};

	await installRtk(vendor, download, build);
	await installRtk(vendor, download, build);

	assert.deepEqual(asked, [
		`https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-oss-test.tar.gz`,
	]);
	accessSync(join(vendor, 'bin', 'rtk'), constants.X_OK);
	assert.equal(readFileSync(join(vendor, 'LICENSE'), 'utf8'), 'Apache-2.0');
	assert.equal(readFileSync(join(vendor, 'VERSION'), 'utf8'), `${RTK_VERSION}\n`);
});

test('refuses a download whose sha256 is not the pinned one, and leaves nothing behind', async () => {
	const { archive, build } = release();
	const vendor = join(mkdtempSync(join(tmpdir(), 'malini-vendor-')), 'rtk');

	await assert.rejects(
		installRtk(vendor, () => Promise.resolve(new Response(archive)), {
			...build,
			sha256: '0'.repeat(64),
		}),
		/has sha256 [0-9a-f]{64}, expected 0{64}/u,
	);
	assert.deepEqual(readdirSync(dirname(vendor)), []);
});
