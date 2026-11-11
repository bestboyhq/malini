import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { InstallProgressPayload } from '$contract/events';
import { isRecord } from '$main/db/rows';
import { saveDownload, type Fetch } from '$main/fs/download';

export const CLAUDE_RELEASES_URL = 'https://downloads.claude.ai/claude-code-releases';
const PLATFORM = 'darwin-arm64';
const REQUEST_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_MS = 300_000;
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.+-]+)?$/u;

export type ClaudeInstallStage = 'download' | 'checksum' | 'setup';

export class ClaudeInstallError extends Error {
	readonly kind: ClaudeInstallStage;

	constructor(kind: ClaudeInstallStage, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ClaudeInstallError';
		this.kind = kind;
	}
}

export type ClaudeInstallOptions = Readonly<{
	fetch: Fetch;
	directory: string;
	environment: Readonly<Record<string, string>>;
	onProgress: (progress: InstallProgressPayload) => void;
	releases?: string;
	stallMs?: number;
}>;

type Release = Readonly<{ version: string; checksum: string; size: number | null }>;

const execFileAsync = promisify(execFile);

export async function installClaudeCode({
	fetch,
	directory,
	environment,
	onProgress,
	releases = CLAUDE_RELEASES_URL,
	stallMs,
}: ClaudeInstallOptions): Promise<void> {
	const { version, checksum, size } = await latestRelease(fetch, releases);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const binary = join(directory, `claude-${version}-${PLATFORM}`);
	try {
		const actual = await downloaded(() =>
			saveDownload(fetch, `${releases}/${version}/${PLATFORM}/claude`, binary, {
				onProgress,
				total: size,
				...(stallMs === undefined ? {} : { stallMs }),
			}),
		);
		if (actual !== checksum) {
			throw new ClaudeInstallError(
				'checksum',
				`The Claude Code download has sha256 ${actual}, expected ${checksum}`,
			);
		}
		await chmod(binary, 0o755);
		await keep(binary, versionPath(environment, version));
		await setUp(binary, version, environment);
	} finally {
		await rm(binary, { force: true });
	}
}

function latestRelease(fetch: Fetch, releases: string): Promise<Release> {
	return downloaded(async () => {
		const version = (await text(fetch, `${releases}/latest`)).trim();
		if (!VERSION.test(version)) {
			throw new Error(`downloads.claude.ai sent no version: ${version.slice(0, 60)}`);
		}
		const manifest: unknown = JSON.parse(await text(fetch, `${releases}/${version}/manifest.json`));
		const build =
			isRecord(manifest) && isRecord(manifest['platforms'])
				? manifest['platforms'][PLATFORM]
				: undefined;
		const checksum = isRecord(build) ? build['checksum'] : undefined;
		if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/u.test(checksum)) {
			throw new Error(`Claude Code ${version} has no ${PLATFORM} build`);
		}
		const size = isRecord(build) && typeof build['size'] === 'number' ? build['size'] : null;
		return { version, checksum, size };
	});
}

async function text(fetch: Fetch, url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.text();
}

async function downloaded<T>(step: () => Promise<T>): Promise<T> {
	try {
		return await step();
	} catch (error) {
		throw new ClaudeInstallError('download', `Could not download Claude Code: ${reason(error)}`, {
			cause: error,
		});
	}
}

function versionPath(environment: Readonly<Record<string, string>>, version: string): string {
	const data =
		environment['XDG_DATA_HOME'] ?? join(environment['HOME'] ?? homedir(), '.local', 'share');
	return join(data, 'claude', 'versions', version);
}

async function keep(binary: string, target: string): Promise<void> {
	const staged = `${target}.malini-${process.pid}`;
	try {
		await mkdir(dirname(target), { recursive: true });
		await copyFile(binary, staged, constants.COPYFILE_FICLONE);
		await chmod(staged, 0o755);
		await rename(staged, target);
	} catch (error) {
		await rm(staged, { force: true });
		throw setUpFailed(reason(error), error);
	}
}

async function setUp(
	binary: string,
	version: string,
	environment: Readonly<Record<string, string>>,
): Promise<void> {
	const run = execFileAsync(binary, ['install', version], {
		env: environment,
		timeout: SETUP_TIMEOUT_MS,
	});
	run.child.stdin?.end();
	try {
		await run;
	} catch (error) {
		const stderr = isRecord(error) && typeof error['stderr'] === 'string' ? error['stderr'] : '';
		throw setUpFailed(stderr.trim().split('\n').at(-1) || reason(error), error);
	}
}

function setUpFailed(detail: string, cause: unknown): ClaudeInstallError {
	return new ClaudeInstallError('setup', `Claude Code could not set itself up: ${detail}`, {
		cause,
	});
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
