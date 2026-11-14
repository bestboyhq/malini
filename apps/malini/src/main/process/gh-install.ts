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
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { saveDownload, type Fetch, type SaveDownloadOptions } from '../fs/download.ts';

export const GH_VERSION = '2.102.0';

const GH_SHA256: Readonly<Record<string, string>> = {
	'darwin-arm64': 'da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e',
	'darwin-x64': 'b245f24eb2bf5f75b426b4c26da3651a107f8d5b6f4fddfbfccc5679041378b3',
	'linux-arm64': '7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484',
	'linux-x64': 'bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386',
	'win32-arm64': '5dcf12aa8525eabd0c46ec414f323ab6cf65229fc2cd46543cc705001bbaf223',
	'win32-x64': 'ae64e556ecc240b200f7eba60d550e4bb60d78e860e69dd88c449405b86067f4',
};

export const SYSTEM_TAR =
	process.platform === 'win32'
		? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
		: 'tar';

export type GhBuild = Readonly<{ url: string; sha256: string; root: string; executable: string }>;

export type GhInstallStage = 'download' | 'checksum' | 'unpack';

export type GhInstallOptions = Partial<SaveDownloadOptions> &
	Readonly<{ sha256?: string; build?: GhBuild }>;

export class GhInstallError extends Error {
	readonly kind: GhInstallStage;

	constructor(kind: GhInstallStage, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GhInstallError';
		this.kind = kind;
	}
}

const execFileAsync = promisify(execFile);

export function ghBuild(platform: string = process.platform, arch: string = process.arch): GhBuild {
	const sha256 = GH_SHA256[`${platform}-${arch}`];
	if (sha256 === undefined) {
		throw new GhInstallError('download', `The GitHub CLI has no build for ${platform} ${arch}`);
	}
	const windows = platform === 'win32';
	const os = platform === 'darwin' ? 'macOS' : windows ? 'windows' : 'linux';
	const name = `gh_${GH_VERSION}_${os}_${arch === 'x64' ? 'amd64' : arch}`;
	const archive = `${name}${platform === 'linux' ? '.tar.gz' : '.zip'}`;
	return {
		url: `https://github.com/cli/cli/releases/download/v${GH_VERSION}/${archive}`,
		sha256,
		root: windows ? '' : name,
		executable: windows ? 'gh.exe' : 'gh',
	};
}

export async function installGh(
	vendor: string,
	fetch: Fetch,
	{
		onProgress = () => {},
		build = ghBuild(),
		sha256 = build.sha256,
		...download
	}: GhInstallOptions = {},
): Promise<void> {
	if (await installed(vendor, build)) return;
	await mkdir(dirname(vendor), { recursive: true });
	const scratch = await mkdtemp(join(dirname(vendor), '.gh-'));
	try {
		const archive = join(scratch, basename(new URL(build.url).pathname));
		const actual = await downloaded(fetch, build.url, archive, { ...download, onProgress });
		if (actual !== sha256) {
			throw new GhInstallError(
				'checksum',
				`The GitHub CLI download has sha256 ${actual}, expected ${sha256}`,
			);
		}
		const staged = join(scratch, 'gh');
		await unpack(archive, scratch, staged, build);
		await rm(vendor, { recursive: true, force: true });
		await rename(staged, vendor);
	} finally {
		await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
	}
}

async function installed(vendor: string, build: GhBuild): Promise<boolean> {
	try {
		await access(join(vendor, 'bin', build.executable), constants.X_OK);
		return (await readFile(join(vendor, 'VERSION'), 'utf8')).trim() === GH_VERSION;
	} catch {
		return false;
	}
}

async function downloaded(
	fetch: Fetch,
	url: string,
	archive: string,
	options: SaveDownloadOptions,
): Promise<string> {
	try {
		return await saveDownload(fetch, url, archive, options);
	} catch (error) {
		throw new GhInstallError('download', `Could not download the GitHub CLI: ${reason(error)}`, {
			cause: error,
		});
	}
}

async function unpack(
	archive: string,
	scratch: string,
	staged: string,
	build: GhBuild,
): Promise<void> {
	try {
		const extracted = join(scratch, 'extracted');
		await mkdir(extracted);
		await execFileAsync(SYSTEM_TAR, ['-xf', archive, '-C', extracted], { windowsHide: true });
		const root = join(extracted, build.root);
		const executable = join(staged, 'bin', build.executable);
		await mkdir(dirname(executable), { recursive: true });
		await copyFile(join(root, 'bin', build.executable), executable);
		await chmod(executable, 0o755);
		await copyFile(join(root, 'LICENSE'), join(staged, 'LICENSE'));
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
