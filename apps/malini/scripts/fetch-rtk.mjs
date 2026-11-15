import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
	access,
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { saveDownload } from '../src/main/fs/download.ts';
import { SYSTEM_TAR } from '../src/main/process/gh-install.ts';

export const RTK_VERSION = '1.2.0';

/** @type {Readonly<Record<string, Readonly<{ asset: string; sha256: string }>>>} */
export const RTK_BUILDS = {
	'darwin-arm64': {
		asset: 'rtk-oss-aarch64-apple-darwin.tar.gz',
		sha256: '1959bd6d89a729ccdee176b7141490bbe750820f032c74f29a752576f2495254',
	},
	'darwin-x64': {
		asset: 'rtk-oss-x86_64-apple-darwin.tar.gz',
		sha256: '48f8cee63ae0b4853f9a77d7839e62ffcca18ef88c408f8a93d4e69986b1ab82',
	},
	'linux-x64': {
		asset: 'rtk-oss-x86_64-unknown-linux-musl.tar.gz',
		sha256: 'a28407dc13038bdc9c2a1f5a047b0c636e0c1d495b15523576e2adb992a06a17',
	},
	'linux-arm64': {
		asset: 'rtk-oss-aarch64-unknown-linux-musl.tar.gz',
		sha256: '9786c61dbbea704e1468ee7060930d3b45b67f79ba2babfb73463e85340628d9',
	},
	'win32-x64': {
		asset: 'rtk-oss-x86_64-pc-windows-msvc.zip',
		sha256: 'd105aaaa55822252f04ac28989e9069c1ea61755ca561940d887cb0b89c785fc',
	},
};

const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'rtk');
const BINARY = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
const execFileAsync = promisify(execFile);

/**
 * @param {string} vendor
 * @param {import('../src/main/fs/download.ts').Fetch} fetch
 * @param {Readonly<{ asset: string; sha256: string }> | undefined} build
 */
export async function installRtk(
	vendor,
	fetch,
	build = RTK_BUILDS[`${process.platform}-${process.arch}`],
) {
	if (!build) {
		console.log(`fetch-rtk: rtk-oss has no build for ${process.platform}-${process.arch}`);
		return;
	}
	if (await installed(vendor)) return;
	await mkdir(dirname(vendor), { recursive: true });
	const scratch = await mkdtemp(join(dirname(vendor), '.rtk-'));
	try {
		const archive = join(scratch, build.asset);
		const url = `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${build.asset}`;
		const actual = await saveDownload(fetch, url, archive, { onProgress: () => {} });
		if (actual !== build.sha256) {
			throw new Error(`${build.asset} has sha256 ${actual}, expected ${build.sha256}`);
		}
		const unpacked = join(scratch, 'unpacked');
		const staged = join(scratch, 'rtk');
		await mkdir(unpacked);
		await execFileAsync(SYSTEM_TAR, ['-xf', archive, '-C', unpacked]);
		await mkdir(join(staged, 'bin'), { recursive: true });
		await copyFile(join(unpacked, BINARY), join(staged, 'bin', BINARY));
		await chmod(join(staged, 'bin', BINARY), 0o755);
		await copyFile(join(unpacked, 'LICENSE'), join(staged, 'LICENSE'));
		await writeFile(join(staged, 'VERSION'), `${RTK_VERSION}\n`);
		await rm(vendor, { recursive: true, force: true });
		await rename(staged, vendor);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** @param {string} vendor */
async function installed(vendor) {
	try {
		await access(join(vendor, 'bin', BINARY), constants.X_OK);
		return (await readFile(join(vendor, 'VERSION'), 'utf8')).trim() === RTK_VERSION;
	} catch {
		return false;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await installRtk(VENDOR, fetch);
