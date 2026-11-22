import type { PlanSync } from '$contract/initiatives';

class PlanSyncAggregate {
	states = $state.raw<Readonly<Record<string, PlanSync>>>({});

	readonly #syncing = new Set<string>();

	set(state: PlanSync): void {
		this.states = { ...this.states, [state.repositoryFullName]: state };
	}

	fail(repositoryFullName: string, error: string): void {
		const state = this.states[repositoryFullName];
		if (state) this.set({ ...state, error });
	}

	begin(repositoryFullName: string): boolean {
		if (this.#syncing.has(repositoryFullName)) return false;
		this.#syncing.add(repositoryFullName);
		return true;
	}

	end(repositoryFullName: string): void {
		this.#syncing.delete(repositoryFullName);
	}
}

export const planSyncAggregate = new PlanSyncAggregate();
