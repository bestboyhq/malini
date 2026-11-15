import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { spawn, type IPty } from 'node-pty';
import type {
	RunShellCommandArgs,
	ShellRun,
	ShellRunAnchor,
	ShellRunState,
} from '$contract/shell-runs';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { environmentVariable, findExecutable } from '$main/process/command';
import { gitBash, preferredShell } from '$main/process/environment';
import { killProcessGroup } from '$main/process/process-group';
import {
	deleteShellRun,
	markShellRunReported,
	storeShellRun,
	storedShellRuns,
} from './shell-runs.repository';

const WINDOWS = process.platform === 'win32';
const COLUMNS = 100;
const ROWS = 30;
const SCROLLBACK = 2_500;
const INTERRUPT = '\u0003';
const MAX_COMMAND_LENGTH = 64 * 1024;
const MAX_INPUT_LENGTH = 64 * 1024;
const REPORTED_OUTPUT_LENGTH = 4_000;
const PUBLISH_EVERY_MS = 100;
const INTERRUPT_GRACE_MS = 2_000;
const TERMINATE_GRACE_MS = 2_000;
const EXIT_GRACE_MS = 2_000;
const POWERSHELL_FENCES = new Set(['powershell', 'pwsh', 'ps1', 'psm1']);
const COMMAND_PROMPT_FENCES = new Set(['cmd', 'bat', 'batch']);
const POWERSHELL_EXIT_ON_FAILURE = '\r\nif (-not $?) { exit 1 }\r\n';
const POWERSHELL_QUOTES = /['\u2018-\u201b]/gu;
const GIT_BASH_MISSING =
	'Run needs Git Bash. Malini installs Git for Windows, and the line above the composer says where that stands.';

export type ReportedShellRun = Readonly<
	Pick<ShellRun, 'command' | 'state' | 'exitCode' | 'output'>
>;

export interface ShellRunsDeps {
	readonly db: MaliniDatabase;
	readonly checkout: (workstreamId: string) => Promise<string> | string;
	readonly environment: () => Readonly<Record<string, string>>;
	readonly changed: (run: ShellRun) => void;
}

interface Entry {
	run: ShellRun;
	pty: IPty | null;
	terminal: Terminal | null;
	failure: string;
	folder: string | null;
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
		for (const { run, reported } of storedShellRuns(deps.db)) {
			this.#entries.set(run.id, {
				run,
				pty: null,
				terminal: null,
				failure: '',
				folder: null,
				stopping: false,
				reported,
				publish: null,
				ended: Promise.resolve(),
				end: () => undefined,
			});
		}
	}

	async start(args: RunShellCommandArgs): Promise<ShellRun> {
		const { workstreamId, command } = args;
		if (command.trim().length === 0 || command.length > MAX_COMMAND_LENGTH) {
			throw new Error(`invalid args: \`command\` must hold 1 to ${MAX_COMMAND_LENGTH} characters`);
		}
		const cwd = await this.#deps.checkout(workstreamId);
		const previous = this.#anchoredAt(args.anchor);
		if (previous?.pty) return previous.run;
		if (previous) this.#entries.delete(previous.run.id);
		const env = { ...this.#deps.environment(), TERM: 'xterm-256color' };
		const entry = this.#register(args);
		let pty: IPty;
		try {
			const shell = shellLaunch(args.language, command, env);
			entry.folder = shell.folder;
			pty = spawn(shell.file, shell.args, {
				name: 'xterm-256color',
				cols: COLUMNS,
				rows: ROWS,
				cwd,
				env,
			});
		} catch (error) {
			this.#fail(entry, error);
			return entry.run;
		}
		const terminal = new Terminal({
			cols: COLUMNS,
			rows: ROWS,
			scrollback: SCROLLBACK,
			logLevel: 'off',
			allowProposedApi: true,
		});
		entry.pty = pty;
		entry.terminal = terminal;
		pty.onData((text) => {
			if (entry.terminal === terminal) terminal.write(text, () => this.#schedulePublish(entry));
		});
		pty.onExit(({ exitCode, signal }) => {
			if (entry.terminal !== terminal) return;
			const state = entry.stopping ? 'stopped' : 'exited';
			terminal.write('', () => this.#finish(entry, state, signal ? null : exitCode));
		});
		return entry.run;
	}

	list(): ShellRun[] {
		return [...this.#entries.values()].map((entry) => entry.run);
	}

	write(runId: string, text: string): void {
		if (text.length > MAX_INPUT_LENGTH) {
			throw new Error(`invalid args: \`text\` must hold at most ${MAX_INPUT_LENGTH} characters`);
		}
		this.#entry(runId).pty?.write(text);
	}

	stop(runId: string): void {
		const entry = this.#entry(runId);
		if (entry.pty === null) return;
		entry.stopping = true;
		entry.pty.write(INTERRUPT);
		setTimeout(() => this.#signal(entry, 'SIGTERM'), INTERRUPT_GRACE_MS).unref();
		setTimeout(
			() => this.#signal(entry, 'SIGKILL'),
			INTERRUPT_GRACE_MS + TERMINATE_GRACE_MS,
		).unref();
	}

	dismiss(runId: string): void {
		if (this.#entry(runId).pty !== null) throw new Error('Stop the command before you dismiss it');
		this.#entries.delete(runId);
		this.#write('forget the command', (db) => deleteShellRun(db, runId));
	}

	report(sessionId: string): ReportedShellRun[] {
		const reported: ReportedShellRun[] = [];
		for (const entry of this.#entries.values()) {
			if (entry.run.sessionId !== sessionId || entry.reported) continue;
			const { id, command, state, exitCode, output } = entry.run;
			if (entry.pty === null) {
				entry.reported = true;
				this.#write('note that the agent read the command', (db) => markShellRunReported(db, id));
			}
			reported.push({
				command,
				state,
				exitCode,
				output: tail(entry.pty === null ? output : rendered(entry)),
			});
		}
		return reported;
	}

	stopWorkstream(workstreamId: string): Promise<void> {
		return this.#terminate((run) => run.workstreamId === workstreamId);
	}

	stopAll(): Promise<void> {
		return this.#terminate(() => true);
	}

	#register({ workstreamId, sessionId, anchor, command }: RunShellCommandArgs): Entry {
		let end: () => void = () => undefined;
		const ended = new Promise<void>((resolve) => {
			end = resolve;
		});
		const entry: Entry = {
			run: {
				id: randomUUID(),
				workstreamId,
				sessionId,
				anchor,
				command,
				state: 'running',
				exitCode: null,
				output: '',
				startedAt: nowIso8601(),
				finishedAt: null,
			},
			pty: null,
			terminal: null,
			failure: '',
			folder: null,
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

	#anchoredAt({ message, block }: ShellRunAnchor): Entry | undefined {
		for (const entry of this.#entries.values()) {
			if (entry.run.anchor.message === message && entry.run.anchor.block === block) return entry;
		}
		return undefined;
	}

	#entry(runId: string): Entry {
		const entry = this.#entries.get(runId);
		if (!entry) throw new Error(`Unknown command run: ${runId}`);
		return entry;
	}

	#schedulePublish(entry: Entry): void {
		if (entry.run.state !== 'running') return;
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
		entry.failure = describeError(error);
		this.#finish(entry, 'failed', null);
	}

	#finish(entry: Entry, state: ShellRunState, exitCode: number | null): void {
		if (entry.run.state !== 'running') return;
		if (entry.publish) clearTimeout(entry.publish);
		entry.publish = null;
		this.#publish(entry, { state, exitCode, finishedAt: nowIso8601() });
		entry.pty = null;
		entry.terminal?.dispose();
		entry.terminal = null;
		if (entry.folder) {
			void rm(entry.folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
		}
		if (this.#entries.has(entry.run.id)) {
			const stored = { run: entry.run, reported: entry.reported };
			this.#write('keep the command output', (db) => storeShellRun(db, stored));
		}
		entry.end();
	}

	#write(what: string, write: (db: MaliniDatabase) => void): void {
		try {
			write(this.#deps.db);
		} catch (error) {
			console.error(`malini: could not ${what}: ${describeError(error)}`);
		}
	}

	#signal(entry: Entry, signal: NodeJS.Signals): void {
		const pty = entry.pty;
		if (pty === null) return;
		if (signal === 'SIGKILL') {
			setTimeout(() => this.#finish(entry, 'stopped', null), EXIT_GRACE_MS).unref();
		}
		try {
			if (WINDOWS) pty.kill();
			else killProcessGroup(pty.pid, signal);
		} catch {
			return;
		}
	}

	async #terminate(matches: (run: ShellRun) => boolean): Promise<void> {
		const running = [...this.#entries.values()].filter(
			(entry) => entry.pty !== null && matches(entry.run),
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
	return `${entry.terminal ? screenText(entry.terminal) : ''}${entry.failure}`;
}

function screenText({ buffer: { active: buffer } }: Terminal): string {
	const cursor = buffer.baseY + buffer.cursorY;
	let last = cursor;
	for (let y = buffer.length - 1; y > cursor; y -= 1) {
		if (buffer.getLine(y)?.translateToString(true)) {
			last = y;
			break;
		}
	}
	let text = buffer.length >= ROWS + SCROLLBACK ? '…' : '';
	for (let y = 0; y <= last; y += 1) {
		const line = buffer.getLine(y);
		if (!line) continue;
		const wraps = buffer.getLine(y + 1)?.isWrapped === true;
		const trimmed = line.translateToString(true);
		if (wraps) text += line.translateToString(false);
		else if (y === cursor)
			text += line.translateToString(false, 0, Math.max(buffer.cursorX, trimmed.length));
		else text += trimmed;
		if (y < last && !wraps) text += '\n';
	}
	return text;
}

type ShellLaunch = Readonly<{ file: string; args: string[] | string; folder: string | null }>;

type WindowsShell = Readonly<{
	file: string;
	extension: string;
	script: (command: string) => string;
	commandLine: (script: string) => string;
}>;

function shellLaunch(
	language: string | null,
	command: string,
	env: Readonly<Record<string, string>>,
): ShellLaunch {
	if (!WINDOWS)
		return { file: preferredShell(env) ?? '/bin/sh', args: ['-c', command], folder: null };
	const shell = windowsShell(language?.toLowerCase() ?? '', env);
	const folder = mkdtempSync(join(tmpdir(), 'malini-run-'));
	const script = join(folder, `command${shell.extension}`);
	writeFileSync(script, shell.script(command));
	return { file: shell.file, args: shell.commandLine(script), folder };
}

function windowsShell(fence: string, env: Readonly<Record<string, string>>): WindowsShell {
	const system = join(environmentVariable(env, 'SystemRoot') ?? 'C:\\Windows', 'System32');
	if (POWERSHELL_FENCES.has(fence)) {
		return {
			file:
				findExecutable('pwsh', environmentVariable(env, 'PATH') ?? '') ??
				join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
			extension: '.ps1',
			script: (command) => `${command}${POWERSHELL_EXIT_ON_FAILURE}`,
			commandLine: (script) =>
				`-NoLogo -NoProfile -Command "Invoke-Expression (Get-Content -LiteralPath '${script.replace(POWERSHELL_QUOTES, '$&$&')}' -Raw -Encoding UTF8)"`,
		};
	}
	if (COMMAND_PROMPT_FENCES.has(fence)) {
		return {
			file: environmentVariable(env, 'ComSpec') ?? join(system, 'cmd.exe'),
			extension: '.cmd',
			script: (command) =>
				['@echo off', 'chcp 65001 >nul', ...command.split(/\r?\n/u)].join('\r\n'),
			commandLine: (script) => `/d /s /c ""${script}""`,
		};
	}
	const bash = gitBash(env);
	if (bash === null) throw new Error(GIT_BASH_MISSING);
	return {
		file: bash,
		extension: '.sh',
		script: (command) => command.replaceAll('\r\n', '\n'),
		commandLine: (script) => `"${script}"`,
	};
}

function tail(text: string): string {
	return text.length > REPORTED_OUTPUT_LENGTH ? `…${text.slice(-REPORTED_OUTPUT_LENGTH)}` : text;
}
