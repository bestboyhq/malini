import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { RunShellCommandArgs, ShellRun, ShellRunState } from '$contract/shell-runs';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { preferredShell } from '$main/process/environment';
import { killProcessGroup } from '$main/process/process-group';
import { terminalText } from '$lib/chat/domain/terminal-text';

const COLUMNS = 100;
const ROWS = 30;
const STDIN_AS_PIPE = '< <(exec /bin/cat)';
// ponytail: macOS script(1) is the pty, so no native addon; no resize or full-screen programs, node-pty and xterm.js when those matter
const PSEUDO_TERMINAL = `exec /usr/bin/script -q /dev/null /bin/sh -c 'stty cols ${COLUMNS} rows ${ROWS} 2>/dev/null; exec "$0" -c "$1"' "$0" "$1" ${STDIN_AS_PIPE}`;
const INTERRUPT = '\u0003';
const MAX_COMMAND_LENGTH = 64 * 1024;
const MAX_INPUT_LENGTH = 64 * 1024;
const MAX_OUTPUT_LENGTH = 256 * 1024;
const REPORTED_OUTPUT_LENGTH = 4_000;
const PUBLISH_EVERY_MS = 100;
const INTERRUPT_GRACE_MS = 2_000;
const TERMINATE_GRACE_MS = 2_000;

export type ReportedShellRun = Readonly<
	Pick<ShellRun, 'command' | 'state' | 'exitCode' | 'output'>
>;

export interface ShellRunsDeps {
	readonly checkout: (workstreamId: string) => Promise<string> | string;
	readonly environment: () => Readonly<Record<string, string>>;
	readonly changed: (run: ShellRun) => void;
}

interface Entry {
	run: ShellRun;
	child: ChildProcessWithoutNullStreams | null;
	raw: string;
	clipped: boolean;
	stopping: boolean;
	reported: boolean;
	publish: NodeJS.Timeout | null;
	readonly ended: Promise<void>;
	readonly end: () => void;
}

export class ShellRuns {
	readonly #entries = new Map<string, Entry>();
	readonly #deps: ShellRunsDeps;

	constructor(deps: ShellRunsDeps) {
		this.#deps = deps;
	}

	async start({ workstreamId, sessionId, command }: RunShellCommandArgs): Promise<ShellRun> {
		if (command.trim().length === 0 || command.length > MAX_COMMAND_LENGTH) {
			throw new Error(`invalid args: \`command\` must hold 1 to ${MAX_COMMAND_LENGTH} characters`);
		}
		const cwd = await this.#deps.checkout(workstreamId);
		const env = { ...this.#deps.environment(), TERM: 'xterm-256color' };
		const entry = this.#register({ workstreamId, sessionId, command });
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(
				'/bin/bash',
				['-c', PSEUDO_TERMINAL, preferredShell(env) ?? '/bin/sh', command],
				{
					cwd,
					env,
					stdio: 'pipe',
					detached: true,
				},
			);
		} catch (error) {
			this.#fail(entry, error);
			return entry.run;
		}
		entry.child = child;
		child.stdout.setEncoding('utf8').on('data', (text: string) => this.#append(entry, text));
		child.stderr.setEncoding('utf8').on('data', (text: string) => this.#append(entry, text));
		child.stdin.on('error', () => undefined);
		child.once('error', (error) => this.#fail(entry, error));
		child.once('exit', () => child.stdin.end());
		child.once('close', (code) => this.#finish(entry, entry.stopping ? 'stopped' : 'exited', code));
		return entry.run;
	}

	list(): ShellRun[] {
		return [...this.#entries.values()].map((entry) => entry.run);
	}

	write(runId: string, text: string): void {
		if (text.length > MAX_INPUT_LENGTH) {
			throw new Error(`invalid args: \`text\` must hold at most ${MAX_INPUT_LENGTH} characters`);
		}
		this.#entry(runId).child?.stdin.write(text);
	}

	stop(runId: string): void {
		const entry = this.#entry(runId);
		if (entry.child === null) return;
		entry.stopping = true;
		entry.child.stdin.write(INTERRUPT);
		setTimeout(() => this.#signal(entry, 'SIGTERM'), INTERRUPT_GRACE_MS).unref();
		setTimeout(
			() => this.#signal(entry, 'SIGKILL'),
			INTERRUPT_GRACE_MS + TERMINATE_GRACE_MS,
		).unref();
	}

	dismiss(runId: string): void {
		if (this.#entry(runId).child !== null)
			throw new Error('Stop the command before you dismiss it');
		this.#entries.delete(runId);
	}

	report(sessionId: string): ReportedShellRun[] {
		const reported: ReportedShellRun[] = [];
		for (const entry of this.#entries.values()) {
			if (entry.run.sessionId !== sessionId || entry.reported) continue;
			if (entry.child === null) entry.reported = true;
			const { command, state, exitCode } = entry.run;
			reported.push({ command, state, exitCode, output: tail(rendered(entry)) });
		}
		return reported;
	}

	stopWorkstream(workstreamId: string): Promise<void> {
		return this.#terminate((run) => run.workstreamId === workstreamId);
	}

	stopAll(): Promise<void> {
		return this.#terminate(() => true);
	}

	#register(args: RunShellCommandArgs): Entry {
		let end: () => void = () => undefined;
		const ended = new Promise<void>((resolve) => {
			end = resolve;
		});
		const entry: Entry = {
			run: {
				id: randomUUID(),
				...args,
				state: 'running',
				exitCode: null,
				output: '',
				startedAt: nowIso8601(),
				finishedAt: null,
			},
			child: null,
			raw: '',
			clipped: false,
			stopping: false,
			reported: false,
			publish: null,
			ended,
			end,
		};
		this.#entries.set(entry.run.id, entry);
		this.#deps.changed(entry.run);
		return entry;
	}

	#entry(runId: string): Entry {
		const entry = this.#entries.get(runId);
		if (!entry) throw new Error(`Unknown command run: ${runId}`);
		return entry;
	}

	#append(entry: Entry, text: string): void {
		entry.raw += text;
		if (entry.raw.length > MAX_OUTPUT_LENGTH) {
			entry.raw = entry.raw.slice(-MAX_OUTPUT_LENGTH);
			entry.clipped = true;
		}
		entry.publish ??= setTimeout(() => {
			entry.publish = null;
			this.#publish(entry, {});
		}, PUBLISH_EVERY_MS);
	}

	#publish(
		entry: Entry,
		change: Partial<Pick<ShellRun, 'state' | 'exitCode' | 'finishedAt'>>,
	): void {
		entry.run = { ...entry.run, ...change, output: rendered(entry) };
		if (this.#entries.has(entry.run.id)) this.#deps.changed(entry.run);
	}

	#fail(entry: Entry, error: unknown): void {
		entry.raw += describeError(error);
		this.#finish(entry, 'failed', null);
	}

	#finish(entry: Entry, state: ShellRunState, exitCode: number | null): void {
		if (entry.run.state !== 'running') return;
		if (entry.publish) clearTimeout(entry.publish);
		entry.publish = null;
		entry.child = null;
		this.#publish(entry, { state, exitCode, finishedAt: nowIso8601() });
		entry.end();
	}

	#signal(entry: Entry, signal: NodeJS.Signals): void {
		const pid = entry.child?.pid;
		if (pid === undefined) return;
		try {
			killProcessGroup(pid, signal);
		} catch {
			return;
		}
	}

	async #terminate(matches: (run: ShellRun) => boolean): Promise<void> {
		const running = [...this.#entries.values()].filter(
			(entry) => entry.child !== null && matches(entry.run),
		);
		for (const entry of running) {
			entry.stopping = true;
			this.#signal(entry, 'SIGTERM');
		}
		const killing = setTimeout(() => {
			for (const entry of running) this.#signal(entry, 'SIGKILL');
		}, TERMINATE_GRACE_MS);
		await Promise.all(running.map((entry) => entry.ended));
		clearTimeout(killing);
	}
}

function rendered(entry: Entry): string {
	const text = terminalText(entry.raw);
	return entry.clipped ? `…${text}` : text;
}

function tail(text: string): string {
	return text.length > REPORTED_OUTPUT_LENGTH ? `…${text.slice(-REPORTED_OUTPUT_LENGTH)}` : text;
}
