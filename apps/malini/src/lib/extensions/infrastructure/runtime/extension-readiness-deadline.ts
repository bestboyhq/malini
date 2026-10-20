export const EXTENSION_WORKSTREAM_READINESS_DEADLINE_MS = 15_000;

type ReadinessDeadlineOptions = Readonly<{
	deadlineMs?: number;
	onTimeout(workstreamId: string): void;
	setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}>;

export class ExtensionWorkstreamReadinessDeadline {
	readonly #deadlineMs: number;
	readonly #onTimeout: (workstreamId: string) => void;
	readonly #setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	readonly #clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
	#workstreamId: string | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: ReadinessDeadlineOptions) {
		this.#deadlineMs = positiveDeadline(options.deadlineMs);
		this.#onTimeout = options.onTimeout;
		this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
	}

	defer(workstreamId: string): void {
		if (!workstreamId) {
			this.cancel();
			return;
		}
		this.cancel();
		this.#workstreamId = workstreamId;
	}

	start(workstreamId: string, options: { restart?: boolean } = {}): boolean {
		if (!workstreamId || this.#workstreamId !== workstreamId) return false;
		if (!options.restart && this.#timer !== null) return true;
		this.#clearActiveTimer();
		const timer = this.#setTimer(() => {
			if (this.#timer !== timer || this.#workstreamId !== workstreamId) return;
			this.#timer = null;
			this.#onTimeout(workstreamId);
		}, this.#deadlineMs);
		this.#timer = timer;
		return true;
	}

	settle(workstreamId: string): void {
		if (workstreamId !== this.#workstreamId) return;
		this.cancel();
	}

	cancel(workstreamId?: string): void {
		if (workstreamId !== undefined && workstreamId !== this.#workstreamId) return;
		this.#clearActiveTimer();
		this.#workstreamId = null;
	}

	#clearActiveTimer(): void {
		if (this.#timer !== null) this.#clearTimer(this.#timer);
		this.#timer = null;
	}
}

function positiveDeadline(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value
		: EXTENSION_WORKSTREAM_READINESS_DEADLINE_MS;
}
