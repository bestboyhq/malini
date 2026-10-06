import {
	PULL_REQUEST_STATE_POLL_INTERVAL_MS,
	type PullRequestState,
	type PullRequestTarget,
} from '$lib/pull-requests/domain/pull-request-state';
import { loadPullRequestStates } from '$lib/pull-requests/infrastructure/services/pull-request-states.service';

const MAX_CONCURRENT_PULL_REQUEST_LOADS = 4;

type PullRequestStateLoader = (
	targets: readonly PullRequestTarget[],
) => Promise<Readonly<Record<string, PullRequestState>>>;

type BatchRefresh = {
	trailing: Set<string>;
	promise: Promise<void>;
};

export class PullRequestStateAggregate {
	stateByWorkstream = $state<Record<string, PullRequestState>>({});
	loadingByWorkstream = $state<Record<string, boolean>>({});
	lastErrorByWorkstream = $state<Record<string, string | null>>({});

	#targets = new Map<string, PullRequestTarget>();
	#requestRevision = new Map<string, number>();
	#refreshes = new Map<string, BatchRefresh>();
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	readonly #load: PullRequestStateLoader;

	constructor(load: PullRequestStateLoader) {
		this.#load = load;
	}

	stateFor(workstreamId: string): PullRequestState {
		return this.stateByWorkstream[workstreamId] ?? 'unknown';
	}

	track(workstreams: readonly PullRequestTarget[]): Promise<void> {
		const nextTargets = new Map<string, PullRequestTarget>();
		const changedWorkstreamIds: string[] = [];
		for (const workstream of workstreams) {
			const target: PullRequestTarget = {
				workstreamId: workstream.workstreamId,
				repoId: workstream.repoId,
				head: workstream.head,
				base: workstream.base,
			};
			nextTargets.set(target.workstreamId, target);
			const previous = this.#targets.get(target.workstreamId);
			if (!previous || !sameTarget(previous, target)) {
				this.#invalidate(target.workstreamId);
				changedWorkstreamIds.push(target.workstreamId);
			}
		}

		for (const workstreamId of this.#targets.keys()) {
			if (!nextTargets.has(workstreamId)) this.#invalidate(workstreamId);
		}
		this.#targets = nextTargets;
		this.stateByWorkstream = seedUnknown(
			retainTracked(this.stateByWorkstream, nextTargets),
			nextTargets,
		);
		this.loadingByWorkstream = retainTracked(this.loadingByWorkstream, nextTargets);
		this.lastErrorByWorkstream = retainTracked(this.lastErrorByWorkstream, nextTargets);

		return this.#refreshMany(changedWorkstreamIds);
	}

	refreshAll(): Promise<void> {
		return this.#refreshMany([...this.#targets.keys()]);
	}

	ensureWorkstream(workstreamId: string): Promise<void> {
		if (!this.#targets.has(workstreamId)) return Promise.resolve();
		return this.#refreshes.get(workstreamId)?.promise ?? this.refreshWorkstream(workstreamId);
	}

	refreshWorkstream(workstreamId: string): Promise<void> {
		if (!this.#targets.has(workstreamId)) return Promise.resolve();
		const existing = this.#refreshes.get(workstreamId);
		if (existing) {
			existing.trailing.add(workstreamId);
			this.#invalidate(workstreamId);
			return existing.promise;
		}
		return this.#startBatch([workstreamId]);
	}

	startPolling(intervalMs = PULL_REQUEST_STATE_POLL_INTERVAL_MS): () => void {
		this.stopPolling();
		const safeIntervalMs =
			Number.isFinite(intervalMs) && intervalMs > 0
				? intervalMs
				: PULL_REQUEST_STATE_POLL_INTERVAL_MS;
		const timer = setInterval(() => void this.refreshAll(), safeIntervalMs);
		this.#pollTimer = timer;
		return () => {
			if (this.#pollTimer !== timer) return;
			clearInterval(timer);
			this.#pollTimer = null;
		};
	}

	stopPolling(): void {
		if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
		this.#pollTimer = null;
	}

	reset(): void {
		this.stopPolling();
		for (const workstreamId of this.#targets.keys()) this.#invalidate(workstreamId);
		this.#targets.clear();
		this.stateByWorkstream = {};
		this.loadingByWorkstream = {};
		this.lastErrorByWorkstream = {};
	}

	async #refreshMany(workstreamIds: readonly string[]): Promise<void> {
		const joined: Promise<void>[] = [];
		const fresh: string[] = [];
		for (const workstreamId of workstreamIds) {
			const existing = this.#refreshes.get(workstreamId);
			if (existing) {
				existing.trailing.add(workstreamId);
				this.#invalidate(workstreamId);
				joined.push(existing.promise);
			} else {
				fresh.push(workstreamId);
			}
		}

		const batches = groupByRepo(fresh, this.#targets);
		let nextIndex = 0;
		const runNext = async (): Promise<void> => {
			while (nextIndex < batches.length) {
				const batch = batches[nextIndex++];
				if (batch === undefined) break;
				await this.#startBatch(batch);
			}
		};
		await Promise.all([
			...joined,
			...Array.from({ length: Math.min(MAX_CONCURRENT_PULL_REQUEST_LOADS, batches.length) }, () =>
				runNext(),
			),
		]);
	}

	#startBatch(workstreamIds: readonly string[]): Promise<void> {
		let resolveRefresh: () => void = () => undefined;
		const batch: BatchRefresh = {
			trailing: new Set(),
			promise: new Promise<void>((resolve) => {
				resolveRefresh = resolve;
			}),
		};
		for (const workstreamId of workstreamIds) this.#refreshes.set(workstreamId, batch);
		void this.#runBatchLoop(workstreamIds, batch).finally(resolveRefresh);
		return batch.promise;
	}

	async #runBatchLoop(workstreamIds: readonly string[], batch: BatchRefresh): Promise<void> {
		try {
			let pending = [...workstreamIds];
			while (pending.length > 0) {
				for (const workstreamId of pending) batch.trailing.delete(workstreamId);
				const targets = pending
					.map((workstreamId) => this.#targets.get(workstreamId))
					.filter((target): target is PullRequestTarget => target !== undefined);
				if (targets.length > 0) await this.#loadOnce(targets);
				pending = pending.filter(
					(workstreamId) => batch.trailing.has(workstreamId) && this.#targets.has(workstreamId),
				);
			}
		} finally {
			for (const workstreamId of workstreamIds) {
				if (this.#refreshes.get(workstreamId) === batch) this.#refreshes.delete(workstreamId);
			}
		}
	}

	async #loadOnce(targets: readonly PullRequestTarget[]): Promise<void> {
		const revisions = new Map(
			targets.map((target) => [target.workstreamId, this.#invalidate(target.workstreamId)]),
		);
		this.loadingByWorkstream = withValues(this.loadingByWorkstream, targets, true);

		try {
			const states = await this.#load(targets);
			const nextStates = { ...this.stateByWorkstream };
			const nextErrors = { ...this.lastErrorByWorkstream };
			for (const target of targets) {
				if (!this.#isCurrent(target, revisions.get(target.workstreamId))) continue;
				const state = states[target.workstreamId];
				if (state === undefined) {
					nextStates[target.workstreamId] ??= 'unknown';
					continue;
				}
				nextStates[target.workstreamId] = state;
				nextErrors[target.workstreamId] = null;
			}
			this.stateByWorkstream = nextStates;
			this.lastErrorByWorkstream = nextErrors;
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			const nextStates = { ...this.stateByWorkstream };
			const nextErrors = { ...this.lastErrorByWorkstream };
			for (const target of targets) {
				if (!this.#isCurrent(target, revisions.get(target.workstreamId))) continue;
				nextStates[target.workstreamId] ??= 'unknown';
				nextErrors[target.workstreamId] = message;
			}
			this.stateByWorkstream = nextStates;
			this.lastErrorByWorkstream = nextErrors;
		} finally {
			const current = targets.filter((target) =>
				this.#isCurrent(target, revisions.get(target.workstreamId)),
			);
			this.loadingByWorkstream = withValues(this.loadingByWorkstream, current, false);
		}
	}

	#invalidate(workstreamId: string): number {
		const revision = (this.#requestRevision.get(workstreamId) ?? 0) + 1;
		this.#requestRevision.set(workstreamId, revision);
		return revision;
	}

	#isCurrent(target: PullRequestTarget, revision: number | undefined): boolean {
		if (revision === undefined) return false;
		const tracked = this.#targets.get(target.workstreamId);
		return (
			this.#requestRevision.get(target.workstreamId) === revision &&
			tracked !== undefined &&
			sameTarget(tracked, target)
		);
	}
}

function sameTarget(a: PullRequestTarget, b: PullRequestTarget): boolean {
	return a.repoId === b.repoId && a.head === b.head && a.base === b.base;
}

function groupByRepo(
	workstreamIds: readonly string[],
	targets: ReadonlyMap<string, PullRequestTarget>,
): string[][] {
	const batches = new Map<string, string[]>();
	for (const workstreamId of workstreamIds) {
		const target = targets.get(workstreamId);
		if (!target) continue;
		const batch = batches.get(target.repoId);
		if (batch) batch.push(workstreamId);
		else batches.set(target.repoId, [workstreamId]);
	}
	return [...batches.values()];
}

function retainTracked<T>(
	values: Readonly<Record<string, T>>,
	targets: ReadonlyMap<string, PullRequestTarget>,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(values).filter(([workstreamId]) => targets.has(workstreamId)),
	);
}

function seedUnknown(
	values: Record<string, PullRequestState>,
	targets: ReadonlyMap<string, PullRequestTarget>,
): Record<string, PullRequestState> {
	for (const workstreamId of targets.keys()) values[workstreamId] ??= 'unknown';
	return values;
}

function withValues<T>(
	values: Readonly<Record<string, T>>,
	targets: readonly PullRequestTarget[],
	value: T,
): Record<string, T> {
	if (targets.length === 0) return { ...values };
	const next = { ...values };
	for (const target of targets) next[target.workstreamId] = value;
	return next;
}

export const pullRequestStateAggregate = new PullRequestStateAggregate(loadPullRequestStates);
