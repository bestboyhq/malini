import { describeError } from '$main/errors';

export class BackgroundWork {
	readonly #running = new Set<Promise<void>>();
	readonly #log: (line: string) => void;

	constructor(log: (line: string) => void) {
		this.#log = log;
	}

	add(work: Promise<unknown>): void {
		const tracked = (async () => {
			try {
				await work;
			} catch (error) {
				this.#log(`automations: ${describeError(error)}`);
			}
		})();
		this.#running.add(tracked);
		void tracked.finally(() => this.#running.delete(tracked));
	}

	async settled(): Promise<void> {
		while (this.#running.size > 0) await Promise.all(this.#running);
	}
}
