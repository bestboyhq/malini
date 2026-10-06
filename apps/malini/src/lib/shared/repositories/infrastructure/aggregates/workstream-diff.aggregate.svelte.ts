import {
	workstreamDiffFromPatch,
	type WorkstreamDiff,
} from '$shared/repositories/domain/workstream-diff';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

class WorkstreamDiffAggregate {
	diffs: Readonly<Record<string, WorkstreamDiff>> = $state.raw({});

	readonly #revisions = new Map<string, number>();

	diffFor(workstreamId: string, path: string | null): WorkstreamDiff | null {
		return this.diffs[diffKey(workstreamId, path)] ?? null;
	}

	async load(workstreamId: string, path: string | null): Promise<void> {
		const key = diffKey(workstreamId, path);
		const revision = (this.#revisions.get(key) ?? 0) + 1;
		this.#revisions.set(key, revision);
		this.#forget(key);
		const diff = workstreamDiffFromPatch(await readPatch(workstreamId, path));
		if (this.#revisions.get(key) !== revision) return;
		this.diffs = { ...this.diffs, [key]: diff };
	}

	reset(): void {
		this.#revisions.clear();
		this.diffs = {};
	}

	#forget(key: string): void {
		if (!(key in this.diffs)) return;
		const next = { ...this.diffs };
		delete next[key];
		this.diffs = next;
	}
}

export const workstreamDiffAggregate = new WorkstreamDiffAggregate();

async function readPatch(workstreamId: string, path: string | null): Promise<string> {
	try {
		return await workstreamsService.diff(workstreamId, path);
	} catch {
		return '';
	}
}

function diffKey(workstreamId: string, path: string | null): string {
	return `${workstreamId}\u0000${path ?? ''}`;
}
