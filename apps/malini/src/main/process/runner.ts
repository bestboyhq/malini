import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { describeError } from '$main/errors';
import { killProcessGroup, processGroupIsAlive, processIsAlive } from './process-group';

export { processGroupIsAlive, processIsAlive } from './process-group';

const STDIO_DRAIN_GRACE_MS = 500;

export interface ProcessSpawnOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly onStdout?: (text: string) => void;
	readonly onStderr?: (text: string) => void;
}

export type ProcessExit =
	| { readonly kind: 'exited'; readonly code: number }
	| { readonly kind: 'signaled'; readonly signal: string }
	| { readonly kind: 'failed'; readonly error: string };

export interface ProcessHandle {
	readonly pid: number | null;
	readonly exit: Promise<ProcessExit>;
}

export interface ProcessRunner {
	spawn(file: string, args: readonly string[], options?: ProcessSpawnOptions): ProcessHandle;
	signalProcessGroup(pid: number, signal: NodeJS.Signals): void;
	processGroupIsAlive(pid: number): boolean;
	processIsAlive(pid: number): boolean;
}

export function createNodeProcessRunner(): ProcessRunner {
	return {
		spawn(file, args, options = {}) {
			const child = spawn(file, [...args], {
				cwd: options.cwd,
				env: options.env,
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: true,
			});
			const exit = new Promise<ProcessExit>((resolve) => {
				let settled = false;
				const settle = (outcome: ProcessExit): void => {
					if (settled) return;
					settled = true;
					resolve(outcome);
				};
				child.once('error', (error) => settle({ kind: 'failed', error: describeError(error) }));
				child.once('close', (code, signal) => settle(exitOutcome(code, signal)));
				child.once('exit', (code, signal) => {
					setTimeout(() => settle(exitOutcome(code, signal)), STDIO_DRAIN_GRACE_MS).unref();
				});
			});
			attachDecoder(child.stdout, options.onStdout);
			attachDecoder(child.stderr, options.onStderr);
			return { pid: child.pid ?? null, exit };
		},
		signalProcessGroup: killProcessGroup,
		processGroupIsAlive,
		processIsAlive,
	};
}

function exitOutcome(code: number | null, signal: NodeJS.Signals | null): ProcessExit {
	if (code !== null) return { kind: 'exited', code };
	return { kind: 'signaled', signal: signal ?? 'SIGKILL' };
}

function attachDecoder(
	stream: NodeJS.ReadableStream | null,
	listener: ((text: string) => void) | undefined,
): void {
	if (!stream) return;
	if (!listener) {
		stream.resume();
		return;
	}
	const decoder = new StringDecoder('utf8');
	stream.on('data', (chunk: Buffer) => {
		const text = decoder.write(chunk);
		if (text.length > 0) listener(text);
	});
	stream.once('end', () => {
		const rest = decoder.end();
		if (rest.length > 0) listener(rest);
	});
}

export interface BoundedRun {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly program: string;
}

export interface BoundedRunOptions {
	readonly deadline: number;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
}

export async function runBounded(
	runner: ProcessRunner,
	file: string,
	args: readonly string[],
	options: BoundedRunOptions,
): Promise<BoundedRun> {
	const program = `\`${file}\``;
	let stdout = '';
	let stderr = '';
	const handle = runner.spawn(file, args, {
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		...(options.env === undefined ? {} : { env: options.env }),
		onStdout: (text) => {
			stdout += text;
		},
		onStderr: (text) => {
			stderr += text;
		},
	});
	let timedOut = false;
	let timer: NodeJS.Timeout | null = null;
	const wait = Math.max(0, options.deadline - Date.now());
	const deadline = new Promise<'deadline'>((resolve) => {
		timer = setTimeout(() => {
			timedOut = true;
			resolve('deadline');
		}, wait);
	});
	try {
		const first = await Promise.race([handle.exit, deadline]);
		if (first === 'deadline') {
			if (handle.pid !== null) runner.signalProcessGroup(handle.pid, 'SIGKILL');
			await handle.exit;
			return { exitCode: null, stdout: '', stderr: '', program };
		}
		if (first.kind === 'failed') throw new Error(`could not run ${program}: ${first.error}`);
		if (timedOut) return { exitCode: null, stdout: '', stderr: '', program };
		return {
			exitCode: first.kind === 'exited' ? first.code : -1,
			stdout,
			stderr,
			program,
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function boundedRunSucceeded(run: BoundedRun): boolean {
	return run.exitCode === 0;
}

export function boundedRunLines(run: BoundedRun): string[] {
	return run.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function boundedRunFailureReason(run: BoundedRun, what: string): string {
	if (run.exitCode === null) {
		return `\`${what}\` (${run.program}) outlived the shutdown budget and was killed`;
	}
	const detail = run.stderr.trim();
	const status = run.exitCode === -1 ? 'by signal' : `exit status: ${run.exitCode}`;
	return detail.length === 0
		? `\`${what}\` exited ${status}`
		: `\`${what}\` exited ${status}: ${detail}`;
}
