import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GitError } from '$main/errors';

export const MAX_GIT_STDERR_BYTES = 64 * 1024;

export type GitEnv = Readonly<Record<string, string>>;

export interface GitRunner {
	(args: readonly string[], env: GitEnv): Promise<string>;
}

let runner: GitRunner = runGitReal;

export type TestGitRunner = (
	args: readonly string[],
	env: GitEnv,
	previous: GitRunner,
) => Promise<string>;

export function installGitRunnerForTests(replacement: TestGitRunner): () => void {
	const previous = runner;
	runner = (args, env) => replacement(args, env, previous);
	return () => {
		runner = previous;
	};
}

export function runGit(args: readonly string[], env: GitEnv = {}): Promise<string> {
	return runner(args, env);
}

interface SpawnedGit {
	stdout: Buffer;
	stderr: Buffer;
	stderrTruncated: boolean;
	stdoutExceeded: boolean;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
}

function spawnGit(
	args: readonly string[],
	env: GitEnv,
	limits: { maxStdoutBytes?: number; input?: string },
): Promise<SpawnedGit> {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn('git', [...args], {
				env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env },
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch (error) {
			reject(GitError.fromNodeError(error));
			return;
		}
		child.stdin.on('error', () => {});
		child.stdin.end(limits.input);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutExceeded = false;
		let stderrTruncated = false;
		let failed: GitError | null = null;

		child.stdout.on('data', (chunk: Buffer) => {
			if (stdoutExceeded) return;
			const budget = limits.maxStdoutBytes;
			if (budget !== undefined && stdoutBytes + chunk.length > budget) {
				stdoutChunks.push(chunk.subarray(0, Math.max(0, budget - stdoutBytes)));
				stdoutBytes = budget;
				stdoutExceeded = true;
				child.kill();
				return;
			}
			stdoutChunks.push(chunk);
			stdoutBytes += chunk.length;
		});
		child.stderr.on('data', (chunk: Buffer) => {
			const available = MAX_GIT_STDERR_BYTES - stderrBytes;
			if (available <= 0) {
				stderrTruncated = true;
				return;
			}
			if (chunk.length > available) {
				stderrChunks.push(chunk.subarray(0, available));
				stderrBytes += available;
				stderrTruncated = true;
				return;
			}
			stderrChunks.push(chunk);
			stderrBytes += chunk.length;
		});
		child.on('error', (error: NodeJS.ErrnoException) => {
			failed =
				error.code === 'ENOENT'
					? GitError.gitUnavailable('git binary not found in PATH')
					: GitError.fromNodeError(error);
		});
		child.on('close', (exitCode, signal) => {
			if (failed) {
				reject(failed);
				return;
			}
			resolve({
				stdout: Buffer.concat(stdoutChunks),
				stderr: Buffer.concat(stderrChunks),
				stderrTruncated,
				stdoutExceeded,
				exitCode,
				signal,
			});
		});
	});
}

export const MAX_GIT_STDOUT_BYTES = 32 * 1024 * 1024;

async function runGitReal(args: readonly string[], env: GitEnv): Promise<string> {
	return runGitWithInput(args, undefined, env);
}

export async function runGitWithInput(
	args: readonly string[],
	input: string | undefined,
	env: GitEnv = {},
): Promise<string> {
	const result = await spawnGit(args, env, {
		maxStdoutBytes: MAX_GIT_STDOUT_BYTES,
		...(input === undefined ? {} : { input }),
	});
	if (result.stdoutExceeded) {
		throw GitError.outputTooLarge(`git ${globalOptions(args).subcommand}`, MAX_GIT_STDOUT_BYTES);
	}
	if (result.exitCode !== 0) throw commandFailure(args, result);
	return result.stdout.toString('utf8');
}

const FOUND_NO_REPOSITORY =
	/not a git repository|git diff --no-index|unable to read current working directory/iu;

function commandFailure(args: readonly string[], result: SpawnedGit): GitError {
	const stderr = result.stderr.toString('utf8');
	const output = stderr.trim().length > 0 ? stderr : result.stdout.toString('utf8');
	return GitError.commandFailed({
		args,
		exitCode: result.exitCode,
		signal: result.signal,
		output,
		outputTruncated: result.stderrTruncated,
		vanishedCheckout: vanishedCheckout(args, output),
	});
}

function vanishedCheckout(args: readonly string[], output: string): string | null {
	const { directory } = globalOptions(args);
	return directory !== null &&
		FOUND_NO_REPOSITORY.test(output) &&
		!existsSync(join(directory, '.git'))
		? directory
		: null;
}

function globalOptions(args: readonly string[]): { subcommand: string; directory: string | null } {
	const directories: string[] = [];
	let index = 0;
	for (; index < args.length; index += 1) {
		const argument = args[index] ?? '';
		if (argument === '-C') directories.push(args[index + 1] ?? '');
		if (argument === '-C' || argument === '-c') index += 1;
		else if (!argument.startsWith('-')) break;
	}
	return {
		subcommand: args[index] ?? '',
		directory: directories.length > 0 ? resolve(...directories) : null,
	};
}

export async function runGitBoundedStdout(
	args: readonly string[],
	maxStdoutBytes: number,
	operation: string,
): Promise<string> {
	const result = await spawnGit(args, {}, { maxStdoutBytes });
	if (result.stdoutExceeded) {
		throw GitError.outputTooLarge(operation, maxStdoutBytes);
	}
	if (result.exitCode !== 0) throw commandFailure(args, result);
	const decoder = new TextDecoder('utf-8', { fatal: true });
	try {
		return decoder.decode(result.stdout);
	} catch {
		throw GitError.git(`${operation} contains non-UTF-8 output`);
	}
}

export const DISABLED_GIT_HOOKS_CONFIG = 'core.hooksPath=/dev/null';
export const DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG = 'protocol.allow=never';
export const ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG = 'protocol.https.allow=always';
export const REQUIRE_TLS_VERIFICATION_CONFIG = 'http.sslVerify=true';
