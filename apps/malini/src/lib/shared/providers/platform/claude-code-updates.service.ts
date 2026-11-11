import { stat } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';
import type { ClaudeCodeBlockedUpdate } from '$contract/agent';
import { runWithTimeout, type RunResult } from '$main/process/environment';

const UPDATE_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
const RECHECK_AFTER_MS = 5 * 60_000;

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
	#blocked: ClaudeCodeBlockedUpdate | null = null;
	#checked: string | null | undefined;

	constructor(deps: ClaudeCodeUpdatesDeps) {
		this.#deps = deps;
	}

	get blocked(): ClaudeCodeBlockedUpdate | null {
		return this.#blocked;
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

	async checkIfStale(): Promise<boolean> {
		const recent = Date.now() - this.#checkedAt < (this.#deps.recheckAfterMs ?? RECHECK_AFTER_MS);
		if (this.#running || !recent || (await this.#replacedSinceCheck())) await this.check();
		const updated = this.#unseen;
		this.#unseen = false;
		return updated;
	}

	async #update(): Promise<boolean> {
		this.#checkedAt = Date.now();
		const executable = this.#deps.executable();
		if (!executable) return false;
		const before = this.#checked === undefined ? await fingerprint(executable) : this.#checked;
		const result = await runWithTimeout(executable, ['update'], {
			env: this.#deps.environment(),
			timeoutMs: UPDATE_TIMEOUT_MS,
		}).catch(() => null);
		this.#checked = await fingerprint(executable);
		const updated = this.#checked !== before;
		if (result && !result.timedOut) this.#blocked = blockedUpdate(result);
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

export function blockedUpdate({ stdout, stderr }: RunResult): ClaudeCodeBlockedUpdate | null {
	const out = stripVTControlCharacters(stdout);
	const command = /^To update, run:\n\s+(.+)$/mu.exec(out)?.[1]?.trim();
	if (command) {
		return {
			managedBy: /^Claude is managed by (.+)\.$/mu.exec(out)?.[1] ?? null,
			version: /^Update available: .+ → (\S+)$/mu.exec(out)?.[1] ?? null,
			command,
		};
	}
	if (!stripVTControlCharacters(stderr).includes('Insufficient permissions to install update')) {
		return null;
	}
	return {
		managedBy: 'npm',
		version: /^New version available: (\S+)/mu.exec(out)?.[1] ?? null,
		command: 'claude install',
	};
}

async function fingerprint(executable: string): Promise<string | null> {
	try {
		const { ino, size, mtimeMs } = await stat(executable);
		return `${ino}:${size}:${mtimeMs}`;
	} catch {
		return null;
	}
}
