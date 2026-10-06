import {
	ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS,
	ACTIVE_WORKSTREAM_TOTALS_REFRESH_INTERVAL_MS,
	pullRequestRefreshIsDue,
	type ActiveWorkstreamFreshnessCallbacks,
	type ActiveWorkstreamFreshnessOptions,
	type ActiveWorkstreamFreshnessPhase,
	type ActiveWorkstreamFreshnessRequest,
} from '$shared/repositories/domain/workstream-freshness';

type TotalsRequest = 'none' | 'ensure' | 'refresh';

type PendingFreshnessRequest = Readonly<{
	totals: TotalsRequest;
	localRepository: boolean;
	pullRequest: boolean;
}>;

type FreshnessQueue = {
	readonly generation: number;
	readonly workstreamId: string;
	pending: PendingFreshnessRequest;
	draining: boolean;
	drainScheduled: boolean;
	retired: boolean;
	idleResolvers: Array<() => void>;
};

const EMPTY_REQUEST: PendingFreshnessRequest = {
	totals: 'none',
	localRepository: false,
	pullRequest: false,
};

const COMPLETE_REQUEST: ActiveWorkstreamFreshnessRequest = {
	totals: true,
	localRepository: true,
	pullRequest: true,
};

export class ActiveWorkstreamFreshnessStore {
	phase: ActiveWorkstreamFreshnessPhase = $state('idle');

	readonly #totalsIntervalMs: number;
	readonly #pullRequestIntervalMs: number;
	readonly #now: () => number;
	readonly #isForeground: () => boolean;
	readonly #subscribeForeground: (listener: () => void) => () => void;

	#workstreamId: string | null = null;
	#generation = 0;
	#started = false;
	#queue: FreshnessQueue | null = null;
	#totalsTimer: ReturnType<typeof setTimeout> | null = null;
	#pullRequestTimer: ReturnType<typeof setTimeout> | null = null;
	#pullRequestRefreshedAt = Number.NEGATIVE_INFINITY;
	#idlePullRequestRefreshes = 0;
	#unsubscribeForeground: (() => void) | null = null;
	#callbacks: ActiveWorkstreamFreshnessCallbacks | null = null;

	constructor(options: ActiveWorkstreamFreshnessOptions = {}) {
		this.#totalsIntervalMs = positiveInterval(
			options.totalsIntervalMs,
			ACTIVE_WORKSTREAM_TOTALS_REFRESH_INTERVAL_MS,
		);
		this.#pullRequestIntervalMs = positiveInterval(
			options.pullRequestIntervalMs,
			ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS,
		);
		this.#now = options.now ?? ((): number => Date.now());
		this.#isForeground = options.isForeground ?? defaultIsForeground;
		this.#subscribeForeground = options.subscribeForeground ?? defaultSubscribeForeground;
	}

	start(callbacks: ActiveWorkstreamFreshnessCallbacks): void {
		if (this.#started) return;
		this.#callbacks = callbacks;
		this.#started = true;
		this.#unsubscribeForeground = this.#subscribeForeground(() => {
			if (!this.#isForeground()) return;
			this.#refreshImmediatelyAndRestartTimers('refresh');
		});
		if (this.#workstreamId) this.#refreshImmediatelyAndRestartTimers('ensure');
	}

	setWorkstream(workstreamId: string | null): void {
		const nextWorkstreamId = workstreamId?.trim() || null;
		if (nextWorkstreamId === this.#workstreamId) return;
		this.#retireQueue(this.#queue);
		this.#workstreamId = nextWorkstreamId;
		this.#generation += 1;
		this.#queue = nextWorkstreamId
			? createFreshnessQueue(this.#generation, nextWorkstreamId)
			: null;
		this.#idlePullRequestRefreshes = 0;
		this.#clearTimers();
		if (this.#started && nextWorkstreamId) {
			this.#refreshImmediatelyAndRestartTimers('ensure');
		}
	}

	refreshNow(request: Partial<ActiveWorkstreamFreshnessRequest> = COMPLETE_REQUEST): Promise<void> {
		return this.#requestRefresh(request, 'refresh');
	}

	#requestRefresh(
		request: Partial<ActiveWorkstreamFreshnessRequest>,
		totalsRequest: Exclude<TotalsRequest, 'none'>,
	): Promise<void> {
		if (!this.#started || !this.#workstreamId || !this.#isForeground()) {
			return Promise.resolve();
		}
		const queue = this.#queue;
		if (!queue || queue.retired) return Promise.resolve();
		const next: PendingFreshnessRequest = {
			totals: request.totals ? totalsRequest : 'none',
			localRepository: request.localRepository ?? false,
			pullRequest: request.pullRequest ?? false,
		};
		if (!hasWork(next)) return Promise.resolve();
		queue.pending = mergeRequests(queue.pending, next);
		const idle = new Promise<void>((resolve) => queue.idleResolvers.push(resolve));
		this.#scheduleDrain(queue);
		return idle;
	}

	stop(): void {
		if (!this.#started && !this.#workstreamId) return;
		this.#started = false;
		this.#workstreamId = null;
		this.#generation += 1;
		this.#retireQueue(this.#queue);
		this.#queue = null;
		this.#clearTimers();
		this.#unsubscribeForeground?.();
		this.#unsubscribeForeground = null;
		this.#callbacks = null;
		this.phase = 'idle';
	}

	#refreshImmediatelyAndRestartTimers(totalsRequest: Exclude<TotalsRequest, 'none'>): void {
		const generation = this.#generation;
		this.#clearTimers();
		if (!this.#isForeground()) {
			this.#scheduleTimers(generation);
			return;
		}
		void this.#requestRefresh(COMPLETE_REQUEST, totalsRequest).finally(() => {
			if (this.#isCurrent(generation)) this.#scheduleTimers(generation);
		});
	}

	#scheduleDrain(queue: FreshnessQueue): void {
		if (queue.retired || queue.draining || queue.drainScheduled) return;
		queue.drainScheduled = true;
		queueMicrotask(() => {
			queue.drainScheduled = false;
			void this.#drain(queue);
		});
	}

	async #drain(queue: FreshnessQueue): Promise<void> {
		if (queue.retired || queue.draining) return;
		queue.draining = true;
		try {
			while (!queue.retired && hasWork(queue.pending)) {
				const request = queue.pending;
				queue.pending = EMPTY_REQUEST;
				if (!this.#isCurrentQueue(queue) || !this.#isForeground()) continue;
				const callbacks = this.#callbacks;
				if (!callbacks) continue;
				if (request.pullRequest) this.#pullRequestRefreshedAt = this.#now();
				await Promise.all(drainTasks(callbacks, request, queue.workstreamId));
			}
		} finally {
			queue.draining = false;
			this.#resolveIdleWaiters(queue);
			if (!queue.retired && hasWork(queue.pending)) this.#scheduleDrain(queue);
		}
	}

	#scheduleTimers(generation: number): void {
		if (!this.#isCurrent(generation)) return;
		this.#clearTimers();
		this.#totalsTimer = setTimeout(
			() => void this.#runTotalsTimer(generation),
			this.#totalsIntervalMs,
		);
		this.#pullRequestTimer = setTimeout(
			() => void this.#runPullRequestTimer(generation),
			this.#pullRequestIntervalMs,
		);
	}

	async #runTotalsTimer(generation: number): Promise<void> {
		this.#totalsTimer = null;
		if (!this.#isCurrent(generation)) return;
		if (this.#isForeground()) {
			await this.refreshNow({ totals: true, localRepository: true });
		}
		if (this.#isCurrent(generation)) {
			this.#totalsTimer = setTimeout(
				() => void this.#runTotalsTimer(generation),
				this.#totalsIntervalMs,
			);
		}
	}

	async #runPullRequestTimer(generation: number): Promise<void> {
		this.#pullRequestTimer = null;
		if (!this.#isCurrent(generation)) return;
		if (this.#isForeground() && this.#pullRequestRefreshIsDue()) {
			await this.refreshNow({ pullRequest: true });
		}
		if (this.#isCurrent(generation)) {
			this.#pullRequestTimer = setTimeout(
				() => void this.#runPullRequestTimer(generation),
				this.#pullRequestIntervalMs,
			);
		}
	}

	#pullRequestRefreshIsDue(): boolean {
		const workstreamId = this.#workstreamId;
		if (!workstreamId) return false;
		const activity = this.#callbacks?.pullRequestActivity?.(workstreamId) ?? 'running';
		const due = pullRequestRefreshIsDue(
			activity,
			this.#idlePullRequestRefreshes,
			this.#now() - this.#pullRequestRefreshedAt,
			this.#pullRequestIntervalMs,
		);
		if (!due) return false;
		this.#idlePullRequestRefreshes = activity === 'idle' ? this.#idlePullRequestRefreshes + 1 : 0;
		return true;
	}

	#clearTimers(): void {
		if (this.#totalsTimer !== null) clearTimeout(this.#totalsTimer);
		if (this.#pullRequestTimer !== null) clearTimeout(this.#pullRequestTimer);
		this.#totalsTimer = null;
		this.#pullRequestTimer = null;
	}

	#isCurrent(generation: number): boolean {
		return this.#started && this.#workstreamId !== null && this.#generation === generation;
	}

	#isCurrentQueue(queue: FreshnessQueue): boolean {
		return (
			!queue.retired &&
			this.#queue === queue &&
			this.#isCurrent(queue.generation) &&
			this.#workstreamId === queue.workstreamId
		);
	}

	#retireQueue(queue: FreshnessQueue | null): void {
		if (!queue || queue.retired) return;
		queue.retired = true;
		queue.pending = EMPTY_REQUEST;
		this.#resolveIdleWaiters(queue);
	}

	#resolveIdleWaiters(queue: FreshnessQueue): void {
		const resolvers = queue.idleResolvers;
		queue.idleResolvers = [];
		for (const resolve of resolvers) resolve();
	}
}

export const activeWorkstreamFreshnessStore = new ActiveWorkstreamFreshnessStore();

function drainTasks(
	callbacks: ActiveWorkstreamFreshnessCallbacks,
	request: PendingFreshnessRequest,
	workstreamId: string,
): Promise<void>[] {
	const tasks: Promise<void>[] = [];
	if (request.totals !== 'none') {
		const ensureTotals = callbacks.ensureTotals;
		if (request.totals === 'ensure' && ensureTotals) {
			tasks.push(settle(() => ensureTotals(workstreamId)));
		} else {
			tasks.push(settle(() => callbacks.refreshTotals(workstreamId)));
		}
	}
	if (request.localRepository) {
		tasks.push(settle(() => callbacks.refreshLocalRepository(workstreamId)));
	}
	if (request.pullRequest) {
		tasks.push(settle(() => callbacks.refreshPullRequest(workstreamId)));
	}
	return tasks;
}

function createFreshnessQueue(generation: number, workstreamId: string): FreshnessQueue {
	return {
		generation,
		workstreamId,
		pending: EMPTY_REQUEST,
		draining: false,
		drainScheduled: false,
		retired: false,
		idleResolvers: [],
	};
}

function mergeRequests(
	left: PendingFreshnessRequest,
	right: PendingFreshnessRequest,
): PendingFreshnessRequest {
	return {
		totals: mergeTotalsRequest(left.totals, right.totals),
		localRepository: left.localRepository || right.localRepository,
		pullRequest: left.pullRequest || right.pullRequest,
	};
}

function mergeTotalsRequest(left: TotalsRequest, right: TotalsRequest): TotalsRequest {
	if (left === 'refresh' || right === 'refresh') return 'refresh';
	if (left === 'ensure' || right === 'ensure') return 'ensure';
	return 'none';
}

function hasWork(request: PendingFreshnessRequest): boolean {
	return request.totals !== 'none' || request.localRepository || request.pullRequest;
}

async function settle(run: () => Promise<void> | void): Promise<void> {
	await Promise.resolve();
	try {
		await run();
	} catch {}
}

function positiveInterval(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.trunc(value)
		: fallback;
}

function defaultIsForeground(): boolean {
	if (typeof document === 'undefined') return false;
	return document.visibilityState === 'visible' && document.hasFocus();
}

function defaultSubscribeForeground(listener: () => void): () => void {
	if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
	window.addEventListener('focus', listener);
	document.addEventListener('visibilitychange', listener);
	return () => {
		window.removeEventListener('focus', listener);
		document.removeEventListener('visibilitychange', listener);
	};
}
