import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';

export { readBrainDocumentCommand };

function readBrainDocumentCommand(path: string): void {
	void brainAggregate.read(path);
}
