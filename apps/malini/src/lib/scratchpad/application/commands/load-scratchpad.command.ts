import { scratchpadsAggregate } from '$lib/scratchpad/infrastructure/aggregates/scratchpads.aggregate.svelte';
import { scratchpadService } from '$lib/scratchpad/infrastructure/services/scratchpad.service';

export { loadScratchpadCommand };

function loadScratchpadCommand(repositoryFullName: string): void {
	const known = scratchpadsAggregate.stateOf(repositoryFullName);
	if (known?.status === 'ready' || known?.status === 'loading') return;
	scratchpadsAggregate.set(repositoryFullName, { status: 'loading' });
	void (async () => {
		try {
			const content = await scratchpadService.load(repositoryFullName);
			scratchpadsAggregate.set(repositoryFullName, { status: 'ready', content });
		} catch (error) {
			scratchpadsAggregate.set(repositoryFullName, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
