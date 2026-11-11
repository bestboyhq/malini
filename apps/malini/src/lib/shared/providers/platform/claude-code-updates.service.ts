import { stat } from 'node:fs/promises';
import { runWithTimeout } from '$main/process/environment';

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

	async checkIfStale(): Promise<boolean> {
		const recent = Date.now() - this.#checkedAt < (this.#deps.recheckAfterMs ?? RECHECK_AFTER_MS);
		if (this.#running || !recent) await this.check();
		const updated = this.#unseen;
		this.#unseen = false;
		return updated;
	}

	async #update(): Promise<boolean> {
		this.#checkedAt = Date.now();
		const executable = this.#deps.executable();
		if (!executable) return false;
		const before = await fingerprint(executable);
		await runWithTimeout(executable, ['update'], {
			env: this.#deps.environment(),
			timeoutMs: UPDATE_TIMEOUT_MS,
		}).catch(() => undefined);
		const updated = (await fingerprint(executable)) !== before;
		this.#unseen ||= updated;
		return updated;
	}
}

async function fingerprint(executable: string): Promise<string | null> {
	try {
		const { ino, size, mtimeMs } = await stat(executable);
		return `${ino}:${size}:${mtimeMs}`;
	} catch {
		return null;
	}
}
