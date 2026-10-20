import { toast } from '$hyper-ui/components/toast';
import { scratchpadsAggregate } from '$lib/scratchpad/infrastructure/aggregates/scratchpads.aggregate.svelte';
import { scratchpadService } from '$lib/scratchpad/infrastructure/services/scratchpad.service';
import { scratchpadWritesStore } from '$lib/scratchpad/infrastructure/stores/scratchpad-writes.store';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { saveScratchpadCommand };

function saveScratchpadCommand(repositoryFullName: string, content: string): void {
	scratchpadsAggregate.set(repositoryFullName, { status: 'ready', content });
	if (!scratchpadWritesStore.queue({ repositoryFullName, content })) return;
	void (async () => {
		for (
			let write = scratchpadWritesStore.take(repositoryFullName);
			write !== null;
			write = scratchpadWritesStore.take(repositoryFullName)
		) {
			try {
				await scratchpadService.save(write.repositoryFullName, write.content);
				scratchpadWritesStore.recover(repositoryFullName);
			} catch (error) {
				if (!scratchpadWritesStore.fail(repositoryFullName)) continue;
				const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
				toast.error(
					`Scratchpad for ${repositoryFullName} not saved${detail ? ` · ${detail}` : ''}. Your next edit tries again.`,
				);
			}
		}
	})();
}
