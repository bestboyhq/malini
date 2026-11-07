import type { CheckoutsFolder } from '$contract/repositories';
import { homePath } from '$lib/app/domain/home-path';
import { checkoutsFolderStore } from '$lib/app/infrastructure/stores/checkouts-folder.store.svelte';

class CheckoutsFolderQuery {
	public readonly data: Omit<CheckoutsFolder, 'home'> | null = $derived.by(() => {
		const state = checkoutsFolderStore.folder;
		if (!state) return null;
		const shown = (path: string): string => homePath(path, state.home);
		return {
			folder: shown(state.folder),
			next: state.next === null ? null : shown(state.next),
			problem: state.problem && { ...state.problem, folder: shown(state.problem.folder) },
		};
	});
	public readonly choosing: boolean = $derived(checkoutsFolderStore.choosing);
}

export const checkoutsFolderQuery = new CheckoutsFolderQuery();
