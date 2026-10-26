import { toast } from '$hyper-ui/components/toast';
import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service.svelte';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { defaultAgentModel, roleForAgentMode } from '$shared/providers/providers.api';

export { shipInForkCommand };

function shipInForkCommand(
	request: Readonly<{
		workstreamId: string;
		sessionId: SessionId;
		atSeq: number;
		prompt: string;
		subject: string;
	}>,
): void {
	const { workstreamId, sessionId, atSeq, prompt, subject } = request;
	const model = chatModelStore.model ?? defaultAgentModel();
	const profile = { ...chatModelStore.profile };
	const requestId = newChatRequestId();
	chatRequestsStore.begin(requestId);
	void (async () => {
		try {
			const transcript = await composerAttachments.stageForkTranscript(
				workstreamId,
				sessionId,
				atSeq,
			);
			const forked = await sessionActivation.mint({
				workstreamId,
				role: roleForAgentMode(profile.mode),
				selection: { model },
				activate: false,
			});
			submitPromptCommand({
				requestId,
				workstreamId,
				sessionId: forked,
				forceFreshSession: false,
				prompt,
				model,
				profile,
				contextFiles: [],
				attachments: [transcript],
				transcriptReferences: [],
				elementReferences: [],
			});
		} catch (error) {
			chatRequestsStore.fail(requestId, errorMessage(error, 'Fork failed'));
		}
		const outcome = await chatRequestsStore.settled(requestId);
		if (outcome.status !== 'failed') return;
		toast.error(`${subject} not shipped · ${outcome.error}`, aboutWorkstream(workstreamId));
	})();
}
