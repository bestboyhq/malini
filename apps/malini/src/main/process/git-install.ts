import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { saveDownload, type Fetch, type SaveDownloadOptions } from '../fs/download.ts';

export const GIT_VERSION = '2.56.1';

const GIT_SHA256: Readonly<Record<string, string>> = {
	'win32-arm64': '0dca0d9f760924a7e6752235d7dd6eb1a9b508ee714b6ed15d89252e5a58c5c9',
	'win32-x64': '9dd04a608ceb5f6ab32a73709e0ecb159d211da71b697c45ff81f6dd0c6b49c7',
};

const INSTALLED = [
	['cmd', 'git.exe'],
	['bin', 'bash.exe'],
] as const;
const LEFT_BY_POST_INSTALL = [['post-install.bat'], ['etc', 'post-install']] as const;
const SCRATCH = '.install-';
const UNPACK_TIMEOUT_MS = 10 * 60_000;
const HELD_OPEN = new Set(['EPERM', 'EACCES', 'EBUSY']);

export type GitBuild = Readonly<{ url: string; sha256: string }>;

export type GitInstallStage = 'download' | 'checksum' | 'unpack';

export type GitInstallOptions = Partial<SaveDownloadOptions> & Readonly<{ build?: GitBuild }>;

export class GitInstallError extends Error {
	readonly kind: GitInstallStage;

	constructor(kind: GitInstallStage, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GitInstallError';
		this.kind = kind;
	}
}

const execFileAsync = promisify(execFile);

export function gitBuild(
	platform: string = process.platform,
	arch: string = process.arch,
): GitBuild {
	const sha256 = GIT_SHA256[`${platform}-${arch}`];
	if (sha256 === undefined) {
		throw new GitInstallError('download', `Git for Windows has no build for ${platform} ${arch}`);
	}
	const asset = `PortableGit-${GIT_VERSION}-${arch === 'x64' ? '64-bit' : arch}.7z.exe`;
	return {
		url: `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/${asset}`,
		sha256,
	};
}

export function gitVendor(root: string): string {
	return join(root, 'vendor', 'git');
}

export function gitHome(vendor: string): string {
	return join(vendor, GIT_VERSION);
}

export function gitHomes(vendor: string): string[] {
	const home = gitHome(vendor);
	if (existsSync(home)) return [home];
	const older = existsSync(vendor)
		? readdirSync(vendor, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
				.map((entry) => entry.name)
				.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
		: [];
	return [home, ...older.map((name) => join(vendor, name))];
}

export async function pruneGitHomes(vendor: string): Promise<void> {
	if (existsSync(gitHome(vendor))) await removeEntries(vendor, (name) => name !== GIT_VERSION);
}

export async function installGit(
	vendor: string,
	fetch: Fetch,
	{ onProgress = () => {}, build = gitBuild(), ...download }: GitInstallOptions = {},
): Promise<void> {
	const home = gitHome(vendor);
	if (existsSync(home)) return;
	await mkdir(vendor, { recursive: true });
	await removeEntries(vendor, (name) => name.startsWith(SCRATCH));
	const scratch = await mkdtemp(join(vendor, SCRATCH));
	try {
		const archive = join(scratch, basename(new URL(build.url).pathname));
		const actual = await downloaded(fetch, build.url, archive, { ...download, onProgress });
		if (actual !== build.sha256) {
			throw new GitInstallError(
				'checksum',
				`The Git for Windows download has sha256 ${actual}, expected ${build.sha256}`,
			);
		}
		await unpack(archive, join(scratch, 'git'), home);
	} finally {
		await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
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
		throw new GitInstallError('download', `Could not download Git for Windows: ${reason(error)}`, {
			cause: error,
		});
	}
}

async function unpack(archive: string, staged: string, home: string): Promise<void> {
	try {
		await execFileAsync(archive, ['-y', `-o${staged}`], {
			windowsHide: true,
			timeout: UNPACK_TIMEOUT_MS,
		});
		const missing = INSTALLED.find((parts) => !existsSync(join(staged, ...parts)));
		if (missing) throw new Error(`${join(...missing)} is missing`);
		if (LEFT_BY_POST_INSTALL.some((parts) => existsSync(join(staged, ...parts)))) {
			throw new Error('its post-install step did not finish');
		}
		await renameWhenFree(staged, home);
	} catch (error) {
		throw new GitInstallError('unpack', `Could not unpack Git for Windows: ${unpacked(error)}`, {
			cause: error,
		});
	}
}

function unpacked(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	if ('killed' in error && error.killed === true) {
		return `it ran for over ${UNPACK_TIMEOUT_MS / 60_000} minutes`;
	}
	const code = 'code' in error ? error.code : undefined;
	if (typeof code === 'number') return `exit code ${code}`;
	return typeof code === 'string' ? code : error.message;
}

async function renameWhenFree(from: string, to: string): Promise<void> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			const code = error instanceof Error && 'code' in error ? error.code : undefined;
			if (attempt >= 50 || typeof code !== 'string' || !HELD_OPEN.has(code)) throw error;
			await sleep(200);
		}
	}
}

async function removeEntries(folder: string, remove: (name: string) => boolean): Promise<void> {
	const entries = await readdir(folder).catch(() => []);
	await Promise.allSettled(
		entries
			.filter(remove)
			.map((name) => rm(join(folder, name), { recursive: true, force: true, maxRetries: 5 })),
	);
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
