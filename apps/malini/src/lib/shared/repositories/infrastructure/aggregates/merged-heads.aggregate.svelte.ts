import type { MergedHead } from '$shared/repositories/domain/workstream';
import { SvelteMap } from 'svelte/reactivity';

class MergedHeadsAggregate {
	readonly #heads = new SvelteMap<string, MergedHead>();

	headFor(workstreamId: string): MergedHead | null {
		return this.#heads.get(workstreamId) ?? null;
	}

	note(workstreamId: string, head: MergedHead | null): void {
		if (head) this.#heads.set(workstreamId, head);
		else this.#heads.delete(workstreamId);
	}
}

export const mergedHeadsAggregate = new MergedHeadsAggregate();
