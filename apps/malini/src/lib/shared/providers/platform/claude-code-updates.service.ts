import { stat } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';
import type { ClaudeCodeFailedUpdate, ClaudeCodeUpdateCheck } from '$contract/agent';
import { runWithTimeout, type RunResult } from '$main/process/environment';

const UPDATE_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
const RECHECK_AFTER_MS = 5 * 60_000;
const PACKAGE_MANAGERS = new Set(['brew', 'winget', 'apk', 'mise']);

export interface ClaudeCodeUpdatesDeps {
	readonly executable: () => string | null;
	readonly environment: () => Readonly<Record<string, string>>;
	readonly intervalMs?: number;
	readonly recheckAfterMs?: number;
}

export class ClaudeCodeUpdates {
	readonly #deps: ClaudeCodeUpdatesDeps;
	#timer: NodeJS.Timeout | null = null;
	#running: Promise<boolean> | null = null;
	#checkedAt = Number.NEGATIVE_INFINITY;
	#unseen = false;
	#failed: ClaudeCodeFailedUpdate | null = null;
	#checked: string | null | undefined;

	constructor(deps: ClaudeCodeUpdatesDeps) {
		this.#deps = deps;
	}

	start(): void {
		if (this.#timer) return;
		void this.check();
		this.#timer = setInterval(() => void this.check(), this.#deps.intervalMs ?? UPDATE_INTERVAL_MS);
		this.#timer.unref();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	check(): Promise<boolean> {
		this.#running ??= this.#update().finally(() => {
			this.#running = null;
		});
		return this.#running;
	}

	async checkIfStale(now = false): Promise<ClaudeCodeUpdateCheck> {
		const recent = Date.now() - this.#checkedAt < (this.#deps.recheckAfterMs ?? RECHECK_AFTER_MS);
		if (now || this.#running || !recent || (await this.#replacedSinceCheck())) await this.check();
		const updated = this.#unseen;
		this.#unseen = false;
		return { updated, failed: this.#failed };
	}

	async #update(): Promise<boolean> {
		try {
			return await this.#updateOnce();
		} finally {
			this.#checkedAt = Date.now();
		}
	}

	async #updateOnce(): Promise<boolean> {
		const executable = this.#deps.executable();
		if (!executable) return false;
		const before = this.#checked === undefined ? await fingerprint(executable) : this.#checked;
		const env = this.#deps.environment();
		const result = await run(executable, ['update'], env);
		const blocked = result && blockedUpdate(result);
		if (blocked) {
			const fix = fixCommand(blocked.command, executable);
			const fixed = fix && (await run(fix[0], fix[1], env));
			this.#failed = fixed?.exitCode === 0 ? null : { version: blocked.version };
		} else if (result) {
			this.#failed = null;
		}
		const current = this.#deps.executable();
		this.#checked = current && (await fingerprint(current));
		const updated = this.#checked !== before;
		this.#unseen ||= updated;
		return updated;
	}

	async #replacedSinceCheck(): Promise<boolean> {
		const executable = this.#deps.executable();
		return (
			this.#checked !== undefined &&
			executable !== null &&
			(await fingerprint(executable)) !== this.#checked
		);
	}
}

export interface BlockedUpdate {
	readonly version: string | null;
	readonly command: string;
}

export function blockedUpdate({ stdout, stderr }: RunResult): BlockedUpdate | null {
	const out = stripVTControlCharacters(stdout);
	const command = /^To update, run:\n\s+(.+)$/mu.exec(out)?.[1]?.trim();
	if (command) {
		return { version: /^Update available: .+ → (\S+)$/mu.exec(out)?.[1] ?? null, command };
	}
	if (!stripVTControlCharacters(stderr).includes('Insufficient permissions to install update')) {
		return null;
	}
	return {
		version: /^New version available: (\S+)/mu.exec(out)?.[1] ?? null,
		command: 'claude install',
	};
}

export function fixCommand(
	command: string,
	executable: string,
): readonly [string, readonly string[]] | null {
	const [program, ...args] = command.split(/\s+/u);
	if (!program || !args.every((arg) => /^[\w@.+-]+$/u.test(arg))) return null;
	if (program === 'claude') return args.join(' ') === 'install' ? [executable, args] : null;
	return PACKAGE_MANAGERS.has(program) ? [program, args] : null;
}

async function run(
	file: string,
	args: readonly string[],
	env: Readonly<Record<string, string>>,
): Promise<RunResult | null> {
	const result = await runWithTimeout(file, args, { env, timeoutMs: UPDATE_TIMEOUT_MS }).catch(
		() => null,
	);
	return result?.timedOut ? null : result;
}

async function fingerprint(executable: string): Promise<string | null> {
	try {
		const { ino, size, mtimeMs } = await stat(executable);
		return `${ino}:${size}:${mtimeMs}`;
	} catch {
		return null;
	}
}
