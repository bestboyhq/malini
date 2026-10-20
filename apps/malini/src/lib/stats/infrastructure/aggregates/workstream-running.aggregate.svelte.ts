import type { WorkstreamRunning } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class WorkstreamRunningAggregate {
	byWorkstream = $state.raw<ReadonlyMap<string, WorkstreamRunning>>(new Map());
	stopping = $state.raw<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const running = await statsService.workstreamRunning();
		if (generation !== this.#generation) return;
		this.#apply(running);
	}

	replace(running: readonly WorkstreamRunning[]): void {
		this.#generation += 1;
		this.#apply(running);
	}

	markStopping(workstreamId: string, itemIds: readonly string[]): void {
		this.#setStopping(workstreamId, [...this.#stoppingIn(workstreamId), ...itemIds]);
	}

	releaseStopping(workstreamId: string, itemIds: readonly string[]): void {
		const released = new Set(itemIds);
		this.#setStopping(
			workstreamId,
			[...this.#stoppingIn(workstreamId)].filter((itemId) => !released.has(itemId)),
		);
	}

	reset(): void {
		this.#generation += 1;
		this.byWorkstream = new Map();
		this.stopping = new Map();
	}

	#apply(running: readonly WorkstreamRunning[]): void {
		this.byWorkstream = new Map(running.map((entry) => [entry.workstreamId, entry]));
		for (const workstreamId of [...this.stopping.keys()]) {
			const present = new Set(this.byWorkstream.get(workstreamId)?.items.map((item) => item.id));
			this.#setStopping(
				workstreamId,
				[...this.#stoppingIn(workstreamId)].filter((itemId) => present.has(itemId)),
			);
		}
	}

	#stoppingIn(workstreamId: string): ReadonlySet<string> {
		return this.stopping.get(workstreamId) ?? new Set();
	}

	#setStopping(workstreamId: string, itemIds: readonly string[]): void {
		const next = new Map(this.stopping);
		if (itemIds.length === 0) next.delete(workstreamId);
		else next.set(workstreamId, new Set(itemIds));
		this.stopping = next;
	}
}

export const workstreamRunningAggregate = new WorkstreamRunningAggregate();
