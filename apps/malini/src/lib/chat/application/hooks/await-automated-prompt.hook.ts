import { submitWorkstreamPromptCommand } from '$lib/chat/application/commands/submit-workstream-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { awaitAutomatedPromptHook };

function awaitAutomatedPromptHook(): (workstreamId: string, prompt: string) => Promise<void> {
	return async (workstreamId, prompt) => {
		const requestId = newChatRequestId();
		submitWorkstreamPromptCommand({ requestId, workstreamId, prompt, automated: true });
		const outcome = await chatRequestsStore.settled(requestId);
		if (outcome.status === 'failed') throw new Error(outcome.error);
	};
}
