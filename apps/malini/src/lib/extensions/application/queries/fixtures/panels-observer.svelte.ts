import { inspectorPanelsQuery } from '../inspector-panels.query.svelte';

export function observePanels(): Readonly<{
	panelIds: () => readonly string[];
	stop: () => void;
}> {
	let latest: readonly string[] = [];
	const stop = $effect.root(() => {
		$effect(() => {
			latest = inspectorPanelsQuery.data.map(({ id }) => id);
		});
	});
	return { panelIds: () => latest, stop };
}
