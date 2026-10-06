import type { Workstream } from '$shared/repositories/domain/workstream';
import {
	WORKSTREAM_UNDO_WINDOW_MS,
	retirementFailureMessage,
	type WorkstreamRetirementOutcome,
} from '$shared/repositories/domain/workstream-retirement';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

type PendingRetirement = Readonly<{
	workstream: Workstream;
	commit: () => Promise<void>;
	timer: ReturnType<typeof setTimeout>;
	settle: (outcome: WorkstreamRetirementOutcome) => void;
	settled: Promise<WorkstreamRetirementOutcome>;
}>;

class WorkstreamRetirementStore {
	readonly #pending = new Map<string, PendingRetirement>();
	readonly #inFlight = new Map<string, Promise<WorkstreamRetirementOutcome>>();

	isPending(workstreamId: string): boolean {
		return this.#pending.has(workstreamId);
	}

	outcome(workstreamId: string): Promise<WorkstreamRetirementOutcome> | null {
		return this.#pending.get(workstreamId)?.settled ?? this.#inFlight.get(workstreamId) ?? null;
	}

	track(workstreamId: string, outcome: Promise<WorkstreamRetirementOutcome>): void {
		this.#inFlight.set(workstreamId, outcome);
		void this.#forgetWhenSettled(workstreamId, outcome);
	}

	retire(input: {
		workstreamId: string;
		commit: () => Promise<void>;
		undoWindowMs?: number;
	}): Promise<WorkstreamRetirementOutcome> | null {
		if (this.#pending.has(input.workstreamId)) return null;
		const workstream = workstreamsAggregate.retireWorkstreamOptimistically(input.workstreamId);
		if (!workstream) return null;

		let settle: (outcome: WorkstreamRetirementOutcome) => void = () => undefined;
		const settled = new Promise<WorkstreamRetirementOutcome>((resolve) => {
			settle = resolve;
		});
		const timer = setTimeout(() => {
			void this.#commit(input.workstreamId);
		}, input.undoWindowMs ?? WORKSTREAM_UNDO_WINDOW_MS);
		this.#pending.set(input.workstreamId, {
			workstream,
			commit: input.commit,
			timer,
			settle,
			settled,
		});
		return settled;
	}

	undo(workstreamId: string): void {
		const pending = this.#pending.get(workstreamId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.#pending.delete(workstreamId);
		workstreamsAggregate.restoreRetiredWorkstream(pending.workstream);
		pending.settle({ status: 'undone' });
	}

	async #forgetWhenSettled(
		workstreamId: string,
		outcome: Promise<WorkstreamRetirementOutcome>,
	): Promise<void> {
		await outcome;
		if (this.#inFlight.get(workstreamId) === outcome) this.#inFlight.delete(workstreamId);
	}

	async #commit(workstreamId: string): Promise<void> {
		const pending = this.#pending.get(workstreamId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.#pending.delete(workstreamId);
		this.track(workstreamId, pending.settled);
		try {
			await pending.commit();
			workstreamsAggregate.forgetRetiredWorkstream(workstreamId);
			pending.settle({ status: 'retired' });
		} catch (cause) {
			workstreamsAggregate.restoreRetiredWorkstream(pending.workstream);
			pending.settle({ status: 'failed', message: retirementFailureMessage(cause) });
		}
	}
}

export const workstreamRetirementStore = new WorkstreamRetirementStore();
