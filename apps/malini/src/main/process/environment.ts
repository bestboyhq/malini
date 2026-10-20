import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { killProcessGroup } from './process-group';
import { StringDecoder } from 'node:string_decoder';

export const TOOLCHAIN_ALLOWLIST = [
	'NVM_DIR',
	'NVM_BIN',
	'NVM_INC',
	'FNM_DIR',
	'FNM_MULTISHELL_PATH',
	'VOLTA_HOME',
	'ASDF_DIR',
	'ASDF_DATA_DIR',
	'ASDF_CONFIG_FILE',
	'MISE_DATA_DIR',
	'MISE_CONFIG_DIR',
	'MISE_CACHE_DIR',
	'PROTO_HOME',
	'BUN_INSTALL',
	'PYENV_ROOT',
	'RBENV_ROOT',
	'SDKMAN_DIR',
	'JAVA_HOME',
	'COREPACK_HOME',
	'npm_config_prefix',
	'PNPM_HOME',
	'CARGO_HOME',
	'RUSTUP_HOME',
] as const;

export const CAPTURE_TIMEOUT_MS = 5_000;

const DRAIN_GRACE_MS = 500;

const DEFAULT_SHELL = '/bin/zsh';
const LAST_RESORT_SHELL = '/bin/sh';
const DIAGNOSTICS_DIRECTORY = 'diagnostics';
const DIAGNOSTICS_FILE_NAME = 'environment.json';

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export type EnvironmentSource = 'login-shell' | 'inherited';

export interface ResolvedEnvironment {
	readonly path: string;
	readonly toolchainVariables: ReadonlyArray<readonly [name: string, value: string]>;
	readonly source: EnvironmentSource;
	readonly degradation: string | null;
}

export type CaptureResult = { readonly raw: string } | { readonly error: string };

export function resolveEnvironmentFrom(
	captured: CaptureResult,
	inherited: EnvironmentVariables,
): ResolvedEnvironment {
	const capturedVariables = 'raw' in captured ? parseEnvironmentRecords(captured.raw) : [];
	const capturedPath = lookup(capturedVariables, 'PATH') ?? '';
	const inheritedPath = inherited['PATH'] ?? '';

	const directories: string[] = [];
	const seen = new Set<string>();
	const push = (candidate: string): void => {
		const entry = candidate.trim();
		if (entry.length === 0 || !isAbsolute(entry)) return;
		if (seen.has(entry)) return;
		seen.add(entry);
		directories.push(entry);
	};
	for (const entry of capturedPath.split(':')) push(entry);
	for (const entry of inheritedPath.split(':')) push(entry);

	const source: EnvironmentSource = capturedPath.length === 0 ? 'inherited' : 'login-shell';
	let degradation: string | null = null;
	if (source === 'inherited') {
		degradation = 'error' in captured ? captured.error : 'the login shell answered without a PATH';
	}

	const toolchainVariables: Array<readonly [string, string]> = [];
	for (const name of TOOLCHAIN_ALLOWLIST) {
		const value = lookup(capturedVariables, name) ?? inherited[name];
		if (value === undefined || value.length === 0) continue;
		toolchainVariables.push([name, value]);
	}

	return { path: directories.join(':'), toolchainVariables, source, degradation };
}

export function childEnvironment(resolved: ResolvedEnvironment): Record<string, string> {
	const env: Record<string, string> = { PATH: resolved.path };
	for (const [name, value] of resolved.toolchainVariables) env[name] = value;
	return env;
}

let resolvedEnvironment: ResolvedEnvironment | null = null;
let pendingResolution: Promise<ResolvedEnvironment> | null = null;

export function resolveEnvironment(): Promise<ResolvedEnvironment> {
	if (resolvedEnvironment) return Promise.resolve(resolvedEnvironment);
	pendingResolution ??= captureAndResolve();
	return pendingResolution;
}

async function captureAndResolve(): Promise<ResolvedEnvironment> {
	const captured = await captureLoginShellEnvironment();
	resolvedEnvironment = resolveEnvironmentFrom(captured, process.env);
	return resolvedEnvironment;
}

export function currentEnvironment(): ResolvedEnvironment {
	return (
		resolvedEnvironment ??
		resolveEnvironmentFrom({ error: 'the login shell has not been captured yet' }, process.env)
	);
}

export function buildSpawnEnvironment(
	overrides: EnvironmentVariables = {},
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined) env[name] = value;
	}
	Object.assign(env, childEnvironment(currentEnvironment()));
	for (const [name, value] of Object.entries(overrides)) {
		if (value === undefined) delete env[name];
		else env[name] = value;
	}
	return env;
}

export function resolveToolPath(
	name: string,
	environment: ResolvedEnvironment = currentEnvironment(),
): string | null {
	if (name.length === 0) return null;
	if (isAbsolute(name)) return isExecutableFile(name) ? name : null;
	if (name.includes('/')) return null;
	for (const directory of environment.path.split(':')) {
		if (directory.length === 0) continue;
		const candidate = join(directory, name);
		if (isExecutableFile(candidate)) return candidate;
	}
	return null;
}

function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate).isFile()) return false;
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function writeEnvironmentDiagnostics(
	appDataRoot: string,
	resolved: ResolvedEnvironment,
): string {
	const directory = join(appDataRoot, DIAGNOSTICS_DIRECTORY);
	mkdirSync(directory, { recursive: true });
	const record = {
		schemaVersion: 1,
		source: resolved.source,
		degradation: resolved.degradation,
		path: resolved.path,
		toolchainVariables: resolved.toolchainVariables.map(([name]) => name),
	};
	const path = join(directory, DIAGNOSTICS_FILE_NAME);
	writeFileSync(path, `${JSON.stringify(record)}\n`);
	return path;
}

export function preferredShell(env: EnvironmentVariables = process.env): string | null {
	const configured = env['SHELL'];
	if (configured && isAbsolute(configured) && existsSync(configured)) return configured;
	for (const fallback of [DEFAULT_SHELL, LAST_RESORT_SHELL]) {
		if (existsSync(fallback)) return fallback;
	}
	return null;
}

export async function captureLoginShellEnvironment(
	options: { shell?: string | null; timeoutMs?: number } = {},
): Promise<CaptureResult> {
	const shell = options.shell === undefined ? preferredShell() : options.shell;
	if (!shell) {
		return { error: 'no usable login shell (`$SHELL` unset and /bin/zsh missing)' };
	}
	const timeoutMs = options.timeoutMs ?? CAPTURE_TIMEOUT_MS;
	let result: RunResult;
	try {
		result = await runWithTimeout(shell, ['-ilc', '/usr/bin/env -0'], { timeoutMs });
	} catch (error) {
		return { error: `could not run \`${shell} -ilc env\`: ${describe(error)}` };
	}
	if (result.timedOut) {
		return { error: `\`${shell} -ilc env\` did not finish within ${timeoutMs / 1000}s` };
	}
	if (result.exitCode !== 0) {
		return { error: `\`${shell} -ilc env\` exited ${result.exitCode}` };
	}
	return { raw: result.stdout };
}

export interface RunOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly timeoutMs: number;
	readonly onStdout?: (text: string) => void;
	readonly onStderr?: (text: string) => void;
}

export interface RunResult {
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly stdout: string;
	readonly stderr: string;
}

export function runWithTimeout(
	file: string,
	args: readonly string[],
	options: RunOptions,
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(file, [...args], {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true,
		});
		const stdout = new PipeCollector(options.onStdout);
		const stderr = new PipeCollector(options.onStderr);
		let settled = false;
		let timedOut = false;
		let exited = false;
		let exitCode: number | null = null;
		let openPipes = 2;
		let drainTimer: NodeJS.Timeout | null = null;

		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			if (drainTimer) clearTimeout(drainTimer);
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolve({ exitCode, timedOut, stdout: stdout.text(), stderr: stderr.text() });
		};
		const pipeClosed = (): void => {
			openPipes -= 1;
			if (openPipes === 0 && exited) finish();
		};

		const deadline = setTimeout(() => {
			timedOut = true;
			if (child.pid !== undefined) killProcessGroup(child.pid, 'SIGKILL');
			child.kill('SIGKILL');
		}, options.timeoutMs);

		child.once('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			reject(error);
		});
		child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
		child.stdout?.once('close', pipeClosed);
		child.stderr?.once('close', pipeClosed);
		child.once('exit', (code) => {
			exited = true;
			exitCode = timedOut ? null : (code ?? -1);
			if (openPipes === 0) {
				finish();
				return;
			}
			drainTimer = setTimeout(finish, DRAIN_GRACE_MS);
		});
	});
}

class PipeCollector {
	private readonly chunks: Buffer[] = [];
	private readonly decoder = new StringDecoder('utf8');

	constructor(private readonly onChunk?: (text: string) => void) {}

	push(chunk: Buffer): void {
		this.chunks.push(chunk);
		if (!this.onChunk) return;
		const text = this.decoder.write(chunk);
		if (text.length > 0) this.onChunk(text);
	}

	text(): string {
		return Buffer.concat(this.chunks).toString('utf8');
	}
}

export function parseEnvironmentRecords(raw: string): Array<readonly [string, string]> {
	const separator = raw.includes('\0') ? '\0' : '\n';
	const records: Array<readonly [string, string]> = [];
	for (const record of raw.split(separator)) {
		const parsed = parseEnvironmentRecord(record.endsWith('\r') ? record.slice(0, -1) : record);
		if (parsed) records.push(parsed);
	}
	return records;
}

function parseEnvironmentRecord(record: string): readonly [string, string] | null {
	let offset = 0;
	for (;;) {
		const separator = record.indexOf('=', offset);
		if (separator === -1) return null;
		const nameStart = record.lastIndexOf('\n', separator - 1) + 1;
		const name = record.slice(nameStart, separator);
		if (isEnvironmentName(name)) return [name, record.slice(separator + 1)];
		offset = separator + 1;
	}
}

function isEnvironmentName(name: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function lookup(variables: ReadonlyArray<readonly [string, string]>, name: string): string | null {
	for (let index = variables.length - 1; index >= 0; index -= 1) {
		const entry = variables[index];
		if (entry && entry[0] === name) return entry[1];
	}
	return null;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
