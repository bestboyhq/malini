import { spawn } from 'node:child_process';
import { GhError } from '$main/errors';

export interface GhResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface RunGhOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	maxBytes?: number;
}

export const MAX_GH_OUTPUT_BYTES = 16 * 1024 * 1024;

export function ghEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const home = base.HOME ?? '';
	const inherited = base.PATH ?? '';
	const augmented = `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${inherited}`;
	return { ...base, PATH: augmented };
}

export function runGh(args: readonly string[], options: RunGhOptions = {}): Promise<GhResult> {
	const maxBytes = options.maxBytes ?? MAX_GH_OUTPUT_BYTES;
	return new Promise<GhResult>((resolve, reject) => {
		const child = spawn('gh', [...args], {
			cwd: options.cwd,
			env: options.env ?? ghEnvironment(),
		});
		let stdout = '';
		let stderr = '';
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let overflowed = false;

		const collect = (chunk: Buffer, stream: 'out' | 'err'): void => {
			if (stream === 'out') {
				stdoutBytes += chunk.length;
				if (stdoutBytes <= maxBytes) stdout += chunk.toString('utf8');
				else overflowed = true;
			} else {
				stderrBytes += chunk.length;
				if (stderrBytes <= maxBytes) stderr += chunk.toString('utf8');
				else overflowed = true;
			}
		};

		child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'));
		child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'));
		child.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				reject(GhError.notInstalled());
				return;
			}
			reject(new GhError('failed', error.message));
		});
		child.on('close', (code) => {
			if (overflowed) {
				reject(new GhError('failed', `gh output exceeded ${maxBytes} bytes`, { code }));
				return;
			}
			resolve({ stdout, stderr, code: code ?? -1 });
		});
	});
}

export async function runGhChecked(
	args: readonly string[],
	options: RunGhOptions = {},
): Promise<GhResult> {
	const result = await runGh(args, options);
	if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code);
	return result;
}

export function parseGhJson<T>(result: GhResult, operation: string): T;
export function parseGhJson(result: GhResult, operation: string): unknown {
	try {
		const parsed: unknown = JSON.parse(result.stdout);
		return parsed;
	} catch {
		throw new GhError('failed', `${operation}: gh returned a body that is not JSON`);
	}
}
