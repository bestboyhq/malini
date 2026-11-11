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
import { promisify } from 'node:util';
import { saveDownload, type Fetch, type SaveDownloadOptions } from '../fs/download.ts';

export const GH_VERSION = '2.102.0';
export const GH_SHA256 = 'da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e';

const ASSET = `gh_${GH_VERSION}_macOS_arm64`;

export const GH_DOWNLOAD_URL = `https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ASSET}.zip`;

export type GhInstallStage = 'download' | 'checksum' | 'unpack';

export type GhInstallOptions = Partial<SaveDownloadOptions> & Readonly<{ sha256?: string }>;

export class GhInstallError extends Error {
	readonly kind: GhInstallStage;

	constructor(kind: GhInstallStage, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GhInstallError';
		this.kind = kind;
	}
}

const execFileAsync = promisify(execFile);

export async function installGh(
	vendor: string,
	fetch: Fetch,
	{ onProgress = () => {}, sha256 = GH_SHA256, ...download }: GhInstallOptions = {},
): Promise<void> {
	if (await installed(vendor)) return;
	await mkdir(dirname(vendor), { recursive: true });
	const scratch = await mkdtemp(join(dirname(vendor), '.gh-'));
	try {
		const zip = join(scratch, 'gh.zip');
		const actual = await downloaded(fetch, zip, { ...download, onProgress });
		if (actual !== sha256) {
			throw new GhInstallError(
				'checksum',
				`The GitHub CLI download has sha256 ${actual}, expected ${sha256}`,
			);
		}
		const staged = join(scratch, 'gh');
		await unpack(zip, scratch, staged);
		await rm(vendor, { recursive: true, force: true });
		await rename(staged, vendor);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

async function installed(vendor: string): Promise<boolean> {
	try {
		await access(join(vendor, 'bin', 'gh'), constants.X_OK);
		return (await readFile(join(vendor, 'VERSION'), 'utf8')).trim() === GH_VERSION;
	} catch {
		return false;
	}
}

async function downloaded(
	fetch: Fetch,
	zip: string,
	options: SaveDownloadOptions,
): Promise<string> {
	try {
		return await saveDownload(fetch, GH_DOWNLOAD_URL, zip, options);
	} catch (error) {
		throw new GhInstallError('download', `Could not download the GitHub CLI: ${reason(error)}`, {
			cause: error,
		});
	}
}

async function unpack(zip: string, scratch: string, staged: string): Promise<void> {
	try {
		await execFileAsync('unzip', ['-q', zip, '-d', scratch]);
		await mkdir(join(staged, 'bin'), { recursive: true });
		await copyFile(join(scratch, ASSET, 'bin', 'gh'), join(staged, 'bin', 'gh'));
		await chmod(join(staged, 'bin', 'gh'), 0o755);
		await copyFile(join(scratch, ASSET, 'LICENSE'), join(staged, 'LICENSE'));
		await writeFile(join(staged, 'VERSION'), `${GH_VERSION}\n`);
	} catch (error) {
		throw new GhInstallError('unpack', `Could not unpack the GitHub CLI: ${reason(error)}`, {
			cause: error,
		});
	}
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
