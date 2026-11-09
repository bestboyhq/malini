import { runWithTimeout } from '$main/process/environment';

const UPDATE_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

export interface ClaudeCodeUpdatesDeps {
	readonly executable: () => string | null;
	readonly environment: () => Readonly<Record<string, string>>;
	readonly intervalMs?: number;
}

export class ClaudeCodeUpdates {
	readonly #deps: ClaudeCodeUpdatesDeps;
	#timer: NodeJS.Timeout | null = null;
	#running: Promise<void> | null = null;

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

	check(): Promise<void> {
		this.#running ??= this.#update().finally(() => {
			this.#running = null;
		});
		return this.#running;
	}

	async #update(): Promise<void> {
		const executable = this.#deps.executable();
		if (!executable) return;
		await runWithTimeout(executable, ['update'], {
			env: this.#deps.environment(),
			timeoutMs: UPDATE_TIMEOUT_MS,
		}).catch(() => undefined);
	}
}
