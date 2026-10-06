export const MAX_CONCURRENT_AGENT_SESSION_PREACTIVATIONS = 1;

export type AgentSessionActivation = (sessionId: string) => Promise<void>;

type QueuedPreactivation = {
	readonly sessionId: string;
	readonly activate: AgentSessionActivation;
	readonly signal?: AbortSignal | undefined;
	readonly promise: Promise<void>;
	readonly resolve: () => void;
	readonly reject: (reason: unknown) => void;
	started: boolean;
	removeAbortListener: (() => void) | null;
};

export class AgentSessionPreactivationCoordinator {
	readonly #maxConcurrentBackground: number;
	readonly #queuedBySession = new Map<string, QueuedPreactivation>();
	readonly #inFlightBySession = new Map<string, Promise<void>>();
	readonly #queue: QueuedPreactivation[] = [];
	#activeBackground = 0;

	constructor(maxConcurrentBackground = MAX_CONCURRENT_AGENT_SESSION_PREACTIVATIONS) {
		if (!Number.isInteger(maxConcurrentBackground) || maxConcurrentBackground < 1) {
			throw new Error('Agent session preactivation concurrency must be a positive integer');
		}
		this.#maxConcurrentBackground = maxConcurrentBackground;
	}

	preactivate(
		sessionId: string,
		activate: AgentSessionActivation,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<void> {
		const normalizedSessionId = sessionId.trim();
		if (!normalizedSessionId || options.signal?.aborted) return Promise.resolve();

		const inFlight = this.#inFlightBySession.get(normalizedSessionId);
		if (inFlight) return inFlight;
		const queued = this.#queuedBySession.get(normalizedSessionId);
		if (queued) return queued.promise;

		let resolve!: () => void;
		let reject!: (reason: unknown) => void;
		const promise = new Promise<void>((nextResolve, nextReject) => {
			resolve = nextResolve;
			reject = nextReject;
		});
		const entry: QueuedPreactivation = {
			sessionId: normalizedSessionId,
			activate,
			signal: options.signal,
			promise,
			resolve,
			reject,
			started: false,
			removeAbortListener: null,
		};
		if (options.signal) {
			const abort = (): void => this.#cancelQueued(entry);
			options.signal.addEventListener('abort', abort, { once: true });
			entry.removeAbortListener = () => options.signal?.removeEventListener('abort', abort);
		}
		this.#queuedBySession.set(normalizedSessionId, entry);
		this.#queue.push(entry);
		this.#pump();
		return promise;
	}

	activateForeground(sessionId: string, activate: AgentSessionActivation): Promise<void> {
		const normalizedSessionId = sessionId.trim();
		if (!normalizedSessionId) return Promise.reject(new Error('Agent session id is required'));

		const inFlight = this.#inFlightBySession.get(normalizedSessionId);
		if (inFlight) return inFlight;
		const queued = this.#queuedBySession.get(normalizedSessionId);
		if (queued) {
			this.#removeQueued(queued);
			return this.#start(queued, false, activate);
		}

		const promise = (async () => {
			await Promise.resolve();
			await activate(normalizedSessionId);
		})();
		this.#inFlightBySession.set(normalizedSessionId, promise);
		const clearInFlight = (): void => {
			if (this.#inFlightBySession.get(normalizedSessionId) === promise) {
				this.#inFlightBySession.delete(normalizedSessionId);
			}
		};
		void (async () => {
			try {
				await promise;
			} catch {}
			clearInFlight();
		})();
		return promise;
	}

	#pump(): void {
		while (this.#activeBackground < this.#maxConcurrentBackground) {
			const entry = this.#queue.shift();
			if (!entry) return;
			if (entry.started || this.#queuedBySession.get(entry.sessionId) !== entry) continue;
			if (entry.signal?.aborted) {
				this.#cancelQueued(entry);
				continue;
			}
			this.#removeQueued(entry);
			this.#activeBackground += 1;
			const finishBackground = (): void => {
				this.#activeBackground -= 1;
				this.#pump();
			};
			void (async () => {
				try {
					await this.#start(entry, true);
				} catch {}
				finishBackground();
			})();
		}
	}

	#start(
		entry: QueuedPreactivation,
		background: boolean,
		activate: AgentSessionActivation = entry.activate,
	): Promise<void> {
		entry.started = true;
		entry.removeAbortListener?.();
		entry.removeAbortListener = null;
		const operation = (async () => {
			await Promise.resolve();
			await activate(entry.sessionId);
		})();
		this.#inFlightBySession.set(entry.sessionId, entry.promise);
		const clearInFlight = (): void => {
			if (this.#inFlightBySession.get(entry.sessionId) === entry.promise) {
				this.#inFlightBySession.delete(entry.sessionId);
			}
			if (!background) this.#pump();
		};
		void (async () => {
			try {
				await operation;
				clearInFlight();
				entry.resolve();
			} catch (reason) {
				clearInFlight();
				entry.reject(reason);
			}
		})();
		return entry.promise;
	}

	#cancelQueued(entry: QueuedPreactivation): void {
		if (entry.started || this.#queuedBySession.get(entry.sessionId) !== entry) return;
		this.#removeQueued(entry);
		entry.resolve();
		this.#pump();
	}

	#removeQueued(entry: QueuedPreactivation): void {
		if (this.#queuedBySession.get(entry.sessionId) === entry) {
			this.#queuedBySession.delete(entry.sessionId);
		}
		entry.removeAbortListener?.();
		entry.removeAbortListener = null;
	}
}

export const agentSessionPreactivation = new AgentSessionPreactivationCoordinator();
