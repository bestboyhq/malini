import { toast } from '$hyper-ui/components/toast';
import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { readNewChatSetup } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { sendFirstPromptCommand };

function sendFirstPromptCommand(request: Readonly<{ workstreamId: string; prompt: string }>): void {
	const { workstreamId, prompt } = request;
	const { selection, profile } = readNewChatSetup(workstreamId);
	const requestId = newChatRequestId();
	submitPromptCommand({
		requestId,
		workstreamId,
		sessionId: null,
		forceFreshSession: true,
		prompt,
		provider: selection.provider,
		model: selection.model,
		profile,
		contextFiles: [],
		attachments: [],
		transcriptReferences: [],
		elementReferences: [],
	});
	void (async () => {
		const outcome = await chatRequestsStore.settled(requestId);
		if (outcome.status !== 'failed') return;
		agentDrafts.setText(agentDraftScopeKey(workstreamId, null), prompt);
		toast.error(
			`First prompt not sent, it is in the composer · ${outcome.error}`,
			aboutWorkstream(workstreamId),
		);
	})();
}
