import { monotonicNow } from '$shared/performance/runtime-diagnostics.svelte';

export const FOREGROUND_ACTIVITY = Object.freeze({
	startingAgent: 'Starting the agent',
});

export type ForegroundActivityMessage =
	(typeof FOREGROUND_ACTIVITY)[keyof typeof FOREGROUND_ACTIVITY];

export type ForegroundActivity = Readonly<{
	id: number;
	message: ForegroundActivityMessage;
	startedAt: number;
}>;

export type ForegroundActivityHandle = Readonly<{
	id: number;
	end(): void;
}>;

const MAX_OPEN_ACTIVITIES = 8;

export class ForegroundActivityChannel {
	#open = $state<readonly ForegroundActivity[]>([]);
	#nextId = 0;
	readonly #now: () => number;

	constructor(now: () => number = monotonicNow) {
		this.#now = now;
	}

	get current(): ForegroundActivity | null {
		return this.#open.at(-1) ?? null;
	}

	begin(message: ForegroundActivityMessage): ForegroundActivityHandle {
		const activity: ForegroundActivity = {
			id: ++this.#nextId,
			message,
			startedAt: this.#now(),
		};
		this.#open = [...this.#open, activity].slice(-MAX_OPEN_ACTIVITIES);
		let ended = false;
		return {
			id: activity.id,
			end: () => {
				if (ended) return;
				ended = true;
				this.#open = this.#open.filter((candidate) => candidate.id !== activity.id);
			},
		};
	}

	async track<T>(message: ForegroundActivityMessage, operation: () => Promise<T>): Promise<T> {
		const handle = this.begin(message);
		try {
			return await operation();
		} finally {
			handle.end();
		}
	}

	reset(): void {
		this.#open = [];
	}
}

export const foregroundActivity = new ForegroundActivityChannel();
