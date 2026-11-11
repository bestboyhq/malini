import { untrack } from 'svelte';
import { loadContextMediaCommand } from '$lib/chat/application/commands/load-context-media.command';
import { contextMedia } from '$lib/chat/infrastructure/services/context-media.service';

export { keepContextMediaFreshHook };

function keepContextMediaFreshHook(workstreamId: string): () => void {
	untrack(() => loadContextMediaCommand(workstreamId));
	return contextMedia.onChanged(workstreamId, () => loadContextMediaCommand(workstreamId));
}
