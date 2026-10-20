export class ReadSlots {
	readonly #limit: number;
	#running = 0;
	readonly #waiting: Array<() => void> = [];

	constructor(limit: number) {
		this.#limit = limit;
	}

	async run<T>(read: () => Promise<T>): Promise<T> {
		if (this.#running < this.#limit) this.#running += 1;
		else await new Promise<void>((resolve) => this.#waiting.push(resolve));
		try {
			return await read();
		} finally {
			const next = this.#waiting.shift();
			if (next) next();
			else this.#running -= 1;
		}
	}
}
