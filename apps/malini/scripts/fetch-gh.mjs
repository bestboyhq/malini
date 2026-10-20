import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GH_VERSION = '2.102.0';
export const GH_SHA256 = 'da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e';

const ASSET = `gh_${GH_VERSION}_macOS_arm64`;
const DOWNLOAD_URL = `https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ASSET}.zip`;
const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'gh');

/**
 * @param {Uint8Array} bytes
 * @param {string} expected
 */
export function verifySha256(bytes, expected) {
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== expected) {
		throw new Error(`gh ${GH_VERSION} download has sha256 ${actual}, expected ${expected}`);
	}
}

async function fetchGh() {
	const stamp = join(VENDOR, 'VERSION');
	if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === GH_VERSION) return;
	const response = await fetch(DOWNLOAD_URL);
	if (!response.ok) throw new Error(`could not download ${DOWNLOAD_URL}: HTTP ${response.status}`);
	const zip = new Uint8Array(await response.arrayBuffer());
	verifySha256(zip, GH_SHA256);
	const scratch = mkdtempSync(join(tmpdir(), 'malini-gh-'));
	try {
		writeFileSync(join(scratch, 'gh.zip'), zip);
		execFileSync('ditto', ['-x', '-k', join(scratch, 'gh.zip'), scratch]);
		rmSync(VENDOR, { recursive: true, force: true });
		mkdirSync(join(VENDOR, 'bin'), { recursive: true });
		copyFileSync(join(scratch, ASSET, 'bin', 'gh'), join(VENDOR, 'bin', 'gh'));
		chmodSync(join(VENDOR, 'bin', 'gh'), 0o755);
		copyFileSync(join(scratch, ASSET, 'LICENSE'), join(VENDOR, 'LICENSE'));
		writeFileSync(stamp, `${GH_VERSION}\n`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await fetchGh();
