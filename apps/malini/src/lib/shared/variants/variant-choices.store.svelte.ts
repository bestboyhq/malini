import { SvelteMap } from 'svelte/reactivity';
import { worktreePageUrl } from '$contract/browser';

export type ChoosableVariant = Readonly<{ id: string; name: string; src: string }>;

export type VariantChoice = Readonly<{
	workstreamId: string;
	variants: readonly ChoosableVariant[];
	chosen: ChoosableVariant;
}>;

export type ChosenVariant<T extends ChoosableVariant> = Readonly<{ variant: T; revision: number }>;

class VariantChoices {
	readonly #revisions = new SvelteMap<string, number>();
	readonly #listeners = new Set<(choice: VariantChoice) => void>();
	#revision = 0;

	newest<T extends ChoosableVariant>(
		workstreamId: string,
		variants: readonly T[],
	): ChosenVariant<T> | null {
		let newest: ChosenVariant<T> | null = null;
		for (const variant of variants) {
			const revision = this.#revisions.get(worktreePageUrl(workstreamId, variant.src)) ?? 0;
			if (revision > (newest?.revision ?? 0)) newest = { variant, revision };
		}
		return newest;
	}

	choose(choice: VariantChoice): void {
		this.show(worktreePageUrl(choice.workstreamId, choice.chosen.src));
		for (const listener of this.#listeners) listener(choice);
	}

	show(page: string): void {
		this.#revision += 1;
		this.#revisions.set(page, this.#revision);
	}

	onChosen(listener: (choice: VariantChoice) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

export const variantChoices = new VariantChoices();
