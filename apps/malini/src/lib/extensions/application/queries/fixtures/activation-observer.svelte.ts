import { extensionActivationGenerationQuery } from '../extension-activation-generation.query.svelte';
import { extensionWorkstreamQuery } from '../extension-workstream.query.svelte';

export function observeActivation(): Readonly<{
	workstreamIds: readonly (string | null)[];
	generations: readonly number[];
	stop: () => void;
}> {
	const workstreamIds: (string | null)[] = [];
	const generations: number[] = [];
	const stop = $effect.root(() => {
		$effect(() => {
			workstreamIds.push(extensionWorkstreamQuery.data?.id ?? null);
		});
		$effect(() => {
			generations.push(extensionActivationGenerationQuery.data);
		});
	});
	return { workstreamIds, generations, stop };
}
