import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isDirectory, isFile } from '$main/fs/stat';
import type { EventBus } from '$main/events';
import { SANDBOX_SCRATCH_PATH } from '$main/git/paths';
import { buildSpawnEnvironment, resolveToolPath } from '$main/process/environment';
import type { ProcessExit, ProcessHandle, ProcessRunner } from '$main/process/runner';
import type { InstallSkipReason, InstallStatus } from '$contract/system';
import {
	REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
	type WorkstreamInstallStatusPayload,
} from '$contract/events';

export type { WorkstreamInstallStatusPayload };

export type { InstallSkipReason, InstallStatus };

export const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;

export const KNOWN_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof KNOWN_PACKAGE_MANAGERS)[number];

export const IGNORE_SCRIPTS_FLAG = '--ignore-scripts';

export const INSTALL_COMPLETION_PATH = join(SANDBOX_SCRATCH_PATH, 'install-complete');

export const ABORT_GRACE_MS = 2_000;
export const ABORT_DEADLINE_MS = 30_000;

export const FAILURE_DETAIL_LIMIT = 600;

export type RepositoryScripts = 'denied' | 'allowedByHuman';

export type InstallPlan =
	| { readonly kind: 'run'; readonly argv: readonly string[] }
	| { readonly kind: 'already-installed' }
	| { readonly kind: 'no-manifest' }
	| { readonly kind: 'unrecognized' };

export type InstallOutcome =
	| { readonly status: 'skipped'; readonly reason: InstallSkipReason }
	| { readonly status: 'already-running' }
	| { readonly status: 'succeeded' }
	| { readonly status: 'failed' }
	| { readonly status: 'aborted' };

interface InstallSource {
	readonly file: string;
	readonly manager: PackageManager;
	readonly verb: readonly string[];
}

function sourceArgv(source: InstallSource, scripts: RepositoryScripts): string[] {
	const argv = [source.manager, ...source.verb];
	if (scripts === 'denied') argv.push(IGNORE_SCRIPTS_FLAG);
	return argv;
}

function sourceFingerprint(source: InstallSource, argv: readonly string[]): string | null {
	let contents: Buffer;
	try {
		contents = readFileSync(source.file);
	} catch {
		return null;
	}
	const hasher = createHash('sha256');
	hasher.update(basename(source.file));
	hasher.update(Buffer.from([0]));
	hasher.update(contents);
	hasher.update(Buffer.from([0]));
	for (const argument of argv) {
		hasher.update(argument);
		hasher.update(Buffer.from([0]));
	}
	return hasher.digest('hex');
}

export function detectInstallPlan(
	worktree: string,
	scripts: RepositoryScripts = 'denied',
): InstallPlan {
	const manifest = join(worktree, 'package.json');
	if (!isFile(manifest)) return { kind: 'no-manifest' };
	const source = installSource(worktree, manifest);
	if (!source) return { kind: 'unrecognized' };
	const argv = sourceArgv(source, scripts);
	if (isDirectory(join(worktree, 'node_modules')) && completionIsCurrent(worktree, source, argv)) {
		return { kind: 'already-installed' };
	}
	return { kind: 'run', argv };
}

function installSource(worktree: string, manifest: string): InstallSource | null {
	const from = (lockfile: string, manager: PackageManager, verb: string[]): InstallSource => ({
		file: join(worktree, lockfile),
		manager,
		verb,
	});
	if (existsSync(join(worktree, 'pnpm-lock.yaml'))) {
		return from('pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile']);
	}
	if (existsSync(join(worktree, 'package-lock.json'))) {
		return from('package-lock.json', 'npm', ['ci']);
	}
	if (existsSync(join(worktree, 'yarn.lock'))) {
		return from('yarn.lock', 'yarn', ['install', '--frozen-lockfile']);
	}
	for (const lockfile of ['bun.lock', 'bun.lockb']) {
		if (existsSync(join(worktree, lockfile))) {
			return from(lockfile, 'bun', ['install', '--frozen-lockfile']);
		}
	}
	const manager = declaredPackageManager(manifest);
	if (!manager) return null;
	return { file: manifest, manager, verb: ['install'] };
}

function completionIsCurrent(
	worktree: string,
	source: InstallSource,
	argv: readonly string[],
): boolean {
	let recorded: string;
	try {
		recorded = readFileSync(join(worktree, INSTALL_COMPLETION_PATH), 'utf8');
	} catch {
		return false;
	}
	const current = sourceFingerprint(source, argv);
	return current !== null && current === recorded.trim();
}

export function recordCompletion(worktree: string, argv: readonly string[]): void {
	const source = installSource(worktree, join(worktree, 'package.json'));
	if (!source) return;
	const fingerprint = sourceFingerprint(source, argv);
	if (fingerprint === null) return;
	const marker = join(worktree, INSTALL_COMPLETION_PATH);
	try {
		mkdirSync(dirname(marker), { recursive: true });
		writeFileSync(marker, fingerprint);
	} catch {}
}

function declaredPackageManager(manifest: string): PackageManager | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifest, 'utf8'));
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const declared: unknown = Reflect.get(parsed, 'packageManager');
	if (typeof declared !== 'string') return null;
	const name = (declared.split('@')[0] ?? '').trim();
	return KNOWN_PACKAGE_MANAGERS.find((manager) => manager === name) ?? null;
}

export function skipReason(plan: InstallPlan): InstallSkipReason | null {
	switch (plan.kind) {
		case 'run':
			return null;
		case 'already-installed':
			return 'already-installed';
		case 'no-manifest':
			return 'no-manifest';
		case 'unrecognized':
			return 'unrecognized-project';
	}
}

export function failureDetail(stdout: string, stderr: string): string {
	const trimmedStderr = stderr.trim();
	const error = trimmedStderr.length === 0 ? stdout.trim() : trimmedStderr;
	if (Buffer.byteLength(error) <= FAILURE_DETAIL_LIMIT) return error;
	const characters = [...error];
	let tail = '';
	for (let index = characters.length - 1; index >= 0; index -= 1) {
		const next = characters[index] + tail;
		if (Buffer.byteLength(next) > FAILURE_DETAIL_LIMIT) break;
		tail = next;
	}
	const newline = tail.indexOf('\n');
	return `…${newline === -1 ? tail : tail.slice(newline + 1)}`;
}

interface InFlightInstall {
	pid: number | null;
	aborted: boolean;
}

export class InstallRegistry {
	private readonly inFlight = new Map<string, InFlightInstall>();
	private readonly waiters = new Set<() => void>();

	constructor(private readonly runner: ProcessRunner) {}

	claim(workstreamId: string): InstallSlot | null {
		if (this.inFlight.has(workstreamId)) return null;
		this.inFlight.set(workstreamId, { pid: null, aborted: false });
		return new InstallSlot(this, workstreamId);
	}

	has(workstreamId: string): boolean {
		return this.inFlight.has(workstreamId);
	}

	attach(workstreamId: string, pid: number): boolean {
		const entry = this.inFlight.get(workstreamId);
		if (!entry) return false;
		entry.pid = pid;
		return !entry.aborted;
	}

	isAborted(workstreamId: string): boolean {
		return this.inFlight.get(workstreamId)?.aborted ?? false;
	}

	release(workstreamId: string): void {
		this.inFlight.delete(workstreamId);
		for (const waiter of [...this.waiters]) waiter();
	}

	async abortAndWait(workstreamId: string): Promise<void> {
		const entry = this.inFlight.get(workstreamId);
		if (!entry) return;
		entry.aborted = true;
		if (entry.pid !== null) this.runner.signalProcessGroup(entry.pid, 'SIGTERM');
		const started = Date.now();
		let escalated = false;
		while (this.inFlight.has(workstreamId)) {
			const remaining = ABORT_DEADLINE_MS - (Date.now() - started);
			if (remaining <= 0) {
				console.error(
					`environment: install for workstream \`${workstreamId}\` did not exit after SIGKILL; continuing without it`,
				);
				return;
			}
			const wait = escalated
				? remaining
				: Math.min(remaining, Math.max(0, ABORT_GRACE_MS - (Date.now() - started)));
			const changed = await this.waitForChange(wait);
			if (!changed && !escalated) {
				escalated = true;
				const pid = this.inFlight.get(workstreamId)?.pid ?? null;
				if (pid !== null) this.runner.signalProcessGroup(pid, 'SIGKILL');
			}
		}
	}

	private waitForChange(timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			let timer: NodeJS.Timeout | null = null;
			const waiter = (): void => {
				this.waiters.delete(waiter);
				if (timer) clearTimeout(timer);
				resolve(true);
			};
			this.waiters.add(waiter);
			timer = setTimeout(() => {
				this.waiters.delete(waiter);
				resolve(false);
			}, timeoutMs);
		});
	}
}

export class InstallSlot {
	private released = false;

	constructor(
		private readonly registry: InstallRegistry,
		readonly workstreamId: string,
	) {}

	attach(pid: number): boolean {
		return this.registry.attach(this.workstreamId, pid);
	}

	isAborted(): boolean {
		return this.registry.isAborted(this.workstreamId);
	}

	dispose(): void {
		if (this.released) return;
		this.released = true;
		this.registry.release(this.workstreamId);
	}
}

export interface InstallDeps {
	readonly runner: ProcessRunner;
	readonly events: EventBus;
	readonly registry: InstallRegistry;
	readonly timeoutMs?: number;
	readonly env?: Readonly<Record<string, string>>;
}

export async function installDependencies(
	deps: InstallDeps,
	workstreamId: string,
	worktree: string,
): Promise<InstallOutcome> {
	const slot = deps.registry.claim(workstreamId);
	if (!slot) {
		return { status: 'already-running' };
	}
	try {
		const plan = detectInstallPlan(worktree);
		const reason = skipReason(plan);
		if (reason !== null || plan.kind !== 'run') {
			const skipped = reason ?? 'unrecognized-project';
			emit(deps.events, workstreamId, 'skipped', { reason: skipped });
			return { status: 'skipped', reason: skipped };
		}
		return await installWithArgv(deps, slot, workstreamId, worktree, plan.argv);
	} finally {
		slot.dispose();
	}
}

type ChildEnd =
	| { readonly kind: 'exited'; readonly code: number }
	| { readonly kind: 'timed-out' }
	| { readonly kind: 'aborted' };

export async function installWithArgv(
	deps: InstallDeps,
	slot: InstallSlot,
	workstreamId: string,
	worktree: string,
	argv: readonly string[],
): Promise<InstallOutcome> {
	const display = argv.join(' ');
	emit(deps.events, workstreamId, 'running', { command: display });
	const started = Date.now();
	const [manager, ...args] = argv;
	if (manager === undefined) throw new Error('detectInstallPlan never produces an empty argv');
	const file = resolveToolPath(manager) ?? manager;
	let stdout = '';
	let stderr = '';
	let end: ChildEnd;
	try {
		end = await runInstallChild(deps, slot, file, args, worktree, {
			onStdout: (text) => {
				stdout += text;
			},
			onStderr: (text) => {
				stderr += text;
			},
		});
	} catch (error) {
		emit(deps.events, workstreamId, 'failed', {
			command: display,
			durationMs: Date.now() - started,
			detail: error instanceof Error ? error.message : String(error),
		});
		return { status: 'failed' };
	}
	const durationMs = Date.now() - started;
	switch (end.kind) {
		case 'exited':
			if (end.code === 0) {
				recordCompletion(worktree, argv);
				emit(deps.events, workstreamId, 'succeeded', { command: display, durationMs });
				return { status: 'succeeded' };
			}
			emit(deps.events, workstreamId, 'failed', {
				command: display,
				durationMs,
				exitCode: end.code,
				detail: failureDetail(stdout, stderr),
			});
			return { status: 'failed' };
		case 'timed-out':
			emit(deps.events, workstreamId, 'failed', {
				command: display,
				durationMs,
				detail: `timed out after ${Math.floor((deps.timeoutMs ?? INSTALL_TIMEOUT_MS) / 60_000)} minutes`,
			});
			return { status: 'failed' };
		case 'aborted':
			emit(deps.events, workstreamId, 'aborted', { command: display, durationMs });
			return { status: 'aborted' };
	}
}

async function runInstallChild(
	deps: InstallDeps,
	slot: InstallSlot,
	file: string,
	args: readonly string[],
	worktree: string,
	sinks: { onStdout: (text: string) => void; onStderr: (text: string) => void },
): Promise<ChildEnd> {
	const handle: ProcessHandle = deps.runner.spawn(file, args, {
		cwd: worktree,
		env: deps.env ?? buildSpawnEnvironment(),
		onStdout: sinks.onStdout,
		onStderr: sinks.onStderr,
	});
	if (handle.pid === null) {
		const outcome = await handle.exit;
		throw new Error(outcome.kind === 'failed' ? outcome.error : 'spawn produced no process');
	}
	const pid = handle.pid;
	if (!slot.attach(pid)) {
		deps.runner.signalProcessGroup(pid, 'SIGKILL');
		await handle.exit;
		return { kind: 'aborted' };
	}
	const timeoutMs = deps.timeoutMs ?? INSTALL_TIMEOUT_MS;
	let timer: NodeJS.Timeout | null = null;
	const deadline = new Promise<'deadline'>((resolve) => {
		timer = setTimeout(() => resolve('deadline'), timeoutMs);
	});
	try {
		const first = await Promise.race([handle.exit, deadline]);
		let exit: ProcessExit;
		if (first === 'deadline') {
			deps.runner.signalProcessGroup(pid, 'SIGKILL');
			exit = await handle.exit;
			if (slot.isAborted()) return { kind: 'aborted' };
			return { kind: 'timed-out' };
		}
		exit = first;
		if (slot.isAborted()) return { kind: 'aborted' };
		if (exit.kind === 'failed') throw new Error(exit.error);
		return { kind: 'exited', code: exit.kind === 'exited' ? exit.code : -1 };
	} finally {
		if (timer) clearTimeout(timer);
		deps.runner.signalProcessGroup(pid, 'SIGKILL');
	}
}

function emit(
	events: EventBus,
	workstreamId: string,
	status: InstallStatus,
	fields: Omit<WorkstreamInstallStatusPayload, 'type' | 'workstreamId' | 'status'>,
): void {
	const payload: WorkstreamInstallStatusPayload = {
		...fields,
		type: REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
		workstreamId,
		status,
	};
	events.emit(REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL, payload);
}
