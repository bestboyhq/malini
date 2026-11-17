import { describeError } from '$main/errors';

export class BackgroundWork {
	readonly #running = new Map<Promise<void>, string>();
	readonly #log: (line: string) => void;

	constructor(log: (line: string) => void) {
		this.#log = log;
	}

	add(work: Promise<unknown>, label: string): void {
		const tracked = (async () => {
			try {
				await work;
			} catch (error) {
				this.#log(`automations: ${describeError(error)}`);
			}
		})();
		this.#running.set(tracked, label);
		void tracked.finally(() => this.#running.delete(tracked));
	}

	pending(): string[] {
		return [...this.#running.values()];
	}

	async settled(): Promise<void> {
		while (this.#running.size > 0) await Promise.all(this.#running.keys());
	}
}
