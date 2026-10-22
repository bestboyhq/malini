import { toast } from '$hyper-ui/components/toast';
import { saveScratchpadCommand } from '$lib/scratchpad/application/commands/save-scratchpad.command';
import { appendScratchpadIdea } from '$lib/scratchpad/domain/scratchpad-idea';
import { scratchpadsAggregate } from '$lib/scratchpad/infrastructure/aggregates/scratchpads.aggregate.svelte';
import { scratchpadService } from '$lib/scratchpad/infrastructure/services/scratchpad.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { addScratchpadIdeaCommand };

function addScratchpadIdeaCommand(repositoryFullName: string, idea: string): void {
	const known = scratchpadsAggregate.stateOf(repositoryFullName);
	if (known?.status === 'ready') {
		addIdea(repositoryFullName, known.content, idea);
		return;
	}
	void (async () => {
		try {
			const stored = await scratchpadService.load(repositoryFullName);
			const pad = scratchpadsAggregate.stateOf(repositoryFullName);
			addIdea(repositoryFullName, pad?.status === 'ready' ? pad.content : stored, idea);
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(
				`Could not open the scratchpad for ${repositoryFullName}${detail ? ` · ${detail}` : ''}.`,
			);
		}
	})();
}

function addIdea(repositoryFullName: string, content: string | null, idea: string): void {
	const next = appendScratchpadIdea(content, idea);
	if (next === null) {
		toast.error(
			`The scratchpad for ${repositoryFullName} could not be read, so nothing was added.`,
		);
		return;
	}
	saveScratchpadCommand(repositoryFullName, next);
	toast.success('Added to the scratchpad');
}
