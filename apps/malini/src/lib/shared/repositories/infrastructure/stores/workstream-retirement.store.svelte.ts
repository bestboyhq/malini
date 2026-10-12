import { SvelteMap } from 'svelte/reactivity';
import type { Workstream } from '$shared/repositories/domain/workstream';
import {
	retirementFailureMessage,
	type WorkstreamRetirementOutcome,
} from '$shared/repositories/domain/workstream-retirement';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

class WorkstreamRetirementStore {
	readonly #inFlight = new SvelteMap<string, Promise<WorkstreamRetirementOutcome>>();

	isRetiring(workstreamId: string): boolean {
		return this.#inFlight.has(workstreamId);
	}

	outcome(workstreamId: string): Promise<WorkstreamRetirementOutcome> | null {
		return this.#inFlight.get(workstreamId) ?? null;
	}

	track(workstreamId: string, outcome: Promise<WorkstreamRetirementOutcome>): void {
		this.#inFlight.set(workstreamId, outcome);
		void this.#forgetWhenSettled(workstreamId, outcome);
	}

	retire(input: {
		workstreamId: string;
		commit: () => Promise<void>;
	}): Promise<WorkstreamRetirementOutcome> | null {
		if (this.#inFlight.has(input.workstreamId)) return null;
		const workstream = workstreamsAggregate.retireWorkstreamOptimistically(input.workstreamId);
		if (!workstream) return null;
		const settled = this.#commit(workstream, input.commit);
		this.track(input.workstreamId, settled);
		return settled;
	}

	async #forgetWhenSettled(
		workstreamId: string,
		outcome: Promise<WorkstreamRetirementOutcome>,
	): Promise<void> {
		await outcome;
		if (this.#inFlight.get(workstreamId) === outcome) this.#inFlight.delete(workstreamId);
	}

	async #commit(
		workstream: Workstream,
		commit: () => Promise<void>,
	): Promise<WorkstreamRetirementOutcome> {
		try {
			await commit();
			workstreamsAggregate.forgetRetiredWorkstream(workstream.id);
			return { status: 'retired' };
		} catch (cause) {
			this.#inFlight.delete(workstream.id);
			workstreamsAggregate.restoreRetiredWorkstream(workstream);
			return { status: 'failed', message: retirementFailureMessage(cause) };
		}
	}
}

export const workstreamRetirementStore = new WorkstreamRetirementStore();
