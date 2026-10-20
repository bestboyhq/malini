export type SerialSubmissionQueueOptions<T> = Readonly<{
	consume(item: T): void | Promise<void>;
	onFailure?(item: T, error: unknown): void;
	onPendingChange?(count: number): void;
}>;

export class SerialSubmissionQueue<T> {
	readonly #consume: SerialSubmissionQueueOptions<T>['consume'];
	readonly #onFailure: SerialSubmissionQueueOptions<T>['onFailure'];
	readonly #onPendingChange: SerialSubmissionQueueOptions<T>['onPendingChange'];
	readonly #items: T[] = [];
	readonly #idleWaiters = new Set<() => void>();
	#draining = false;
	#pending = 0;

	constructor(options: SerialSubmissionQueueOptions<T>) {
		this.#consume = options.consume;
		this.#onFailure = options.onFailure;
		this.#onPendingChange = options.onPendingChange;
	}

	get pending(): number {
		return this.#pending;
	}

	enqueue(item: T): void {
		this.#items.push(item);
		this.#pending += 1;
		this.#onPendingChange?.(this.#pending);
		void this.#drain();
	}

	whenIdle(): Promise<void> {
		if (this.#pending === 0) return Promise.resolve();
		return new Promise((resolve) => this.#idleWaiters.add(resolve));
	}

	async #drain(): Promise<void> {
		if (this.#draining) return;
		this.#draining = true;
		try {
			while (this.#items.length > 0) {
				const item = this.#items.shift();
				if (item === undefined) continue;
				try {
					await this.#consume(item);
				} catch (error) {
					this.#onFailure?.(item, error);
				} finally {
					this.#pending -= 1;
					this.#onPendingChange?.(this.#pending);
				}
			}
		} finally {
			this.#draining = false;
			if (this.#items.length > 0) {
				void this.#drain();
				return;
			}
			if (this.#pending === 0) {
				for (const resolve of this.#idleWaiters) resolve();
				this.#idleWaiters.clear();
			}
		}
	}
}
