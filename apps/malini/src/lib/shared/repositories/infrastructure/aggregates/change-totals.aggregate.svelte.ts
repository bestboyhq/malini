import type { WorkstreamChangeTarget } from '$shared/repositories/domain/workstream';
import type {
	WorkstreamChangeTotals,
	WorkstreamSnapshotReader,
} from '$shared/repositories/domain/workstream-snapshot';
import { workstreamSnapshotsService } from '$shared/repositories/infrastructure/services/workstream-snapshots.service';

export const WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS = 5 * 60_000;
const MAX_CONCURRENT_TOTALS_LOADS = 4;

type WorkstreamChangeTotalsLoader = (input: {
	workstreamId: string;
	baseBranch: string;
}) => Promise<WorkstreamChangeTotals>;

type WorkstreamChangeTotalsSource = WorkstreamChangeTotalsLoader | WorkstreamSnapshotReader;

export class WorkstreamChangeTotalsAggregate {
	totalsByWorkstream = $state<Record<string, WorkstreamChangeTotals>>({});
	loadingByWorkstream = $state<Record<string, boolean>>({});
	lastErrorByWorkstream = $state<Record<string, string | null>>({});

	#targets = new Map<string, WorkstreamChangeTarget>();
	#requestRevision = new Map<string, number>();
	#refreshes = new Map<
		string,
		{
			trailing: boolean;
			promise: Promise<void>;
		}
	>();
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	readonly #source: WorkstreamChangeTotalsSource;

	constructor(source: WorkstreamChangeTotalsSource = workstreamSnapshotsService) {
		this.#source = source;
	}

	track(workstreams: readonly WorkstreamChangeTarget[]): Promise<void> {
		const nextTargets = new Map<string, WorkstreamChangeTarget>();
		const changedWorkstreamIds: string[] = [];
		for (const workstream of workstreams) {
			const target = { id: workstream.id, baseBranch: workstream.baseBranch };
			nextTargets.set(target.id, target);
			const previous = this.#targets.get(target.id);
			if (!previous || previous.baseBranch !== target.baseBranch) {
				this.#invalidate(target.id);
				changedWorkstreamIds.push(target.id);
			}
		}

		for (const workstreamId of this.#targets.keys()) {
			if (!nextTargets.has(workstreamId)) this.#invalidate(workstreamId);
		}
		this.#targets = nextTargets;
		this.totalsByWorkstream = retainTracked(this.totalsByWorkstream, nextTargets);
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
			existing.trailing = true;
			this.#invalidate(workstreamId);
			return existing.promise;
		}

		let resolveRefresh: () => void = () => undefined;
		const state = {
			trailing: false,
			promise: new Promise<void>((resolve) => {
				resolveRefresh = resolve;
			}),
		};
		this.#refreshes.set(workstreamId, state);
		void this.#runRefreshLoop(workstreamId, state).finally(resolveRefresh);
		return state.promise;
	}

	async #runRefreshLoop(
		workstreamId: string,
		state: { trailing: boolean; promise: Promise<void> },
	): Promise<void> {
		try {
			do {
				state.trailing = false;
				await this.#refreshOnce(workstreamId);
			} while (state.trailing && this.#targets.has(workstreamId));
		} finally {
			if (this.#refreshes.get(workstreamId) === state) this.#refreshes.delete(workstreamId);
		}
	}

	async #refreshOnce(workstreamId: string): Promise<void> {
		const target = this.#targets.get(workstreamId);
		if (!target) return;
		const revision = this.#invalidate(workstreamId);
		const source = this.#source;
		if (typeof source !== 'function') {
			source.invalidate({ workstreamId, baseBranch: target.baseBranch });
		}
		this.loadingByWorkstream = { ...this.loadingByWorkstream, [workstreamId]: true };

		try {
			const totals = await loadTotals(source, {
				workstreamId,
				baseBranch: target.baseBranch,
			});
			if (!this.#isCurrent(target, revision)) return;
			this.totalsByWorkstream = {
				...this.totalsByWorkstream,
				[workstreamId]: normalizeTotals(totals),
			};
			this.lastErrorByWorkstream = {
				...this.lastErrorByWorkstream,
				[workstreamId]: null,
			};
		} catch (cause) {
			if (!this.#isCurrent(target, revision)) return;
			this.lastErrorByWorkstream = {
				...this.lastErrorByWorkstream,
				[workstreamId]: cause instanceof Error ? cause.message : String(cause),
			};
		} finally {
			if (this.#isCurrent(target, revision)) {
				this.loadingByWorkstream = {
					...this.loadingByWorkstream,
					[workstreamId]: false,
				};
			}
		}
	}

	startPolling(intervalMs = WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS): () => void {
		this.stopPolling();
		const safeIntervalMs =
			Number.isFinite(intervalMs) && intervalMs > 0
				? intervalMs
				: WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS;
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
		this.totalsByWorkstream = {};
		this.loadingByWorkstream = {};
		this.lastErrorByWorkstream = {};
	}

	async #refreshMany(workstreamIds: readonly string[]): Promise<void> {
		let nextIndex = 0;
		const refreshNext = async (): Promise<void> => {
			while (nextIndex < workstreamIds.length) {
				const workstreamId = workstreamIds[nextIndex++];
				if (workstreamId === undefined) break;
				await this.refreshWorkstream(workstreamId);
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(MAX_CONCURRENT_TOTALS_LOADS, workstreamIds.length) }, () =>
				refreshNext(),
			),
		);
	}

	#invalidate(workstreamId: string): number {
		const revision = (this.#requestRevision.get(workstreamId) ?? 0) + 1;
		this.#requestRevision.set(workstreamId, revision);
		return revision;
	}

	#isCurrent(target: WorkstreamChangeTarget, revision: number): boolean {
		return (
			this.#requestRevision.get(target.id) === revision &&
			this.#targets.get(target.id)?.baseBranch === target.baseBranch
		);
	}
}

export const workstreamChangeTotalsAggregate = new WorkstreamChangeTotalsAggregate();

function loadTotals(
	source: WorkstreamChangeTotalsSource,
	input: Parameters<WorkstreamChangeTotalsLoader>[0],
): Promise<WorkstreamChangeTotals> {
	if (typeof source === 'function') return source(input);
	return snapshotTotals(source, input);
}

async function snapshotTotals(
	snapshots: WorkstreamSnapshotReader,
	input: Parameters<WorkstreamChangeTotalsLoader>[0],
): Promise<WorkstreamChangeTotals> {
	return (await snapshots.get(input)).totals;
}

function retainTracked<T>(
	values: Readonly<Record<string, T>>,
	targets: ReadonlyMap<string, WorkstreamChangeTarget>,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(values).filter(([workstreamId]) => targets.has(workstreamId)),
	);
}

function normalizeTotals(totals: WorkstreamChangeTotals): WorkstreamChangeTotals {
	return {
		additions: normalizeCount(totals.additions),
		deletions: normalizeCount(totals.deletions),
		files: normalizeCount(totals.files),
	};
}

function normalizeCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value));
}
