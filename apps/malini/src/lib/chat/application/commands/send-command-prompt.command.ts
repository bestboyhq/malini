import { toast } from '$hyper-ui/components/toast';
import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import type { SessionId } from '$lib/chat/domain/session';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { defaultAgentModel } from '$shared/providers/providers.api';

export { sendCommandPromptCommand };

function sendCommandPromptCommand(
	request: Readonly<{
		workstreamId: string;
		sessionId: SessionId;
		prompt: string;
		subject: string;
	}>,
): void {
	const { workstreamId, sessionId, prompt, subject } = request;
	const requestId = newChatRequestId();
	submitPromptCommand({
		requestId,
		workstreamId,
		sessionId,
		forceFreshSession: false,
		prompt,
		model: chatModelStore.model ?? defaultAgentModel(),
		profile: { ...chatModelStore.profile },
		contextFiles: [],
		attachments: [],
		transcriptReferences: [],
		elementReferences: [],
	});
	void (async () => {
		const outcome = await chatRequestsStore.settled(requestId);
		if (outcome.status !== 'failed') return;
		toast.error(`${subject} not sent · ${outcome.error}`, aboutWorkstream(workstreamId));
	})();
}
