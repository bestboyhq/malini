import { invoke } from '$shared/port/invoke';
import type {
	WorkstreamSnapshot,
	WorkstreamSnapshotReader,
	WorkstreamSnapshotTarget,
} from '$shared/repositories/domain/workstream-snapshot';

type WorkstreamSnapshotLoader = (input: WorkstreamSnapshotTarget) => Promise<WorkstreamSnapshot>;

type SnapshotEntry = {
	generation: number;
	value: WorkstreamSnapshot | null;
	inFlight: { generation: number; promise: Promise<WorkstreamSnapshot> } | null;
};

export class WorkstreamSnapshotsService implements WorkstreamSnapshotReader {
	readonly #entries = new Map<string, SnapshotEntry>();

	constructor(private readonly load: WorkstreamSnapshotLoader) {}

	get(input: WorkstreamSnapshotTarget): Promise<WorkstreamSnapshot> {
		const target = normalizeTarget(input);
		const key = snapshotKey(target);
		const entry = this.#entries.get(key) ?? this.#createEntry(key);
		if (entry.value) return Promise.resolve(entry.value);
		if (entry.inFlight?.generation === entry.generation) return entry.inFlight.promise;

		const generation = entry.generation;
		const promise = (async (): Promise<WorkstreamSnapshot> => {
			try {
				const snapshot = await this.load(target);
				const current = this.#entries.get(key);
				if (!current || current.generation !== generation) return this.get(target);
				const value = freezeSnapshot(snapshot);
				current.value = value;
				current.inFlight = null;
				return value;
			} catch (error: unknown) {
				const current = this.#entries.get(key);
				if (!current || current.generation !== generation) return this.get(target);
				current.inFlight = null;
				throw error;
			}
		})();
		entry.inFlight = { generation, promise };
		return promise;
	}

	invalidate(input: WorkstreamSnapshotTarget): number {
		const target = normalizeTarget(input);
		const key = snapshotKey(target);
		const entry = this.#entries.get(key);
		if (!entry) {
			this.#entries.set(key, { generation: 1, value: null, inFlight: null });
			return 1;
		}
		if (entry.value === null) return entry.generation;
		entry.generation += 1;
		entry.value = null;
		entry.inFlight = null;
		return entry.generation;
	}

	invalidateWorkstream(workstreamId: string): void {
		const prefix = `${workstreamId.trim()}\u0000`;
		for (const [key, entry] of this.#entries) {
			if (!key.startsWith(prefix) || entry.value === null) continue;
			entry.generation += 1;
			entry.value = null;
			entry.inFlight = null;
		}
	}

	clear(): void {
		this.#entries.clear();
	}

	#createEntry(key: string): SnapshotEntry {
		const entry: SnapshotEntry = { generation: 0, value: null, inFlight: null };
		this.#entries.set(key, entry);
		return entry;
	}
}

function normalizeTarget(input: WorkstreamSnapshotTarget): WorkstreamSnapshotTarget {
	const workstreamId = input.workstreamId.trim();
	const baseBranch = input.baseBranch.trim();
	if (!workstreamId || !baseBranch) throw new Error('Workstream snapshot target is incomplete');
	return { workstreamId, baseBranch };
}

function snapshotKey(input: WorkstreamSnapshotTarget): string {
	return `${input.workstreamId}\u0000${input.baseBranch}`;
}

function freezeSnapshot(input: WorkstreamSnapshot): WorkstreamSnapshot {
	return Object.freeze({
		patch: input.patch,
		totals: Object.freeze({ ...input.totals }),
	});
}

export const workstreamSnapshotsService = new WorkstreamSnapshotsService((target) =>
	invoke('repositories.workstream-snapshot', {
		workstreamId: target.workstreamId,
		baseBranch: target.baseBranch,
	}),
);
