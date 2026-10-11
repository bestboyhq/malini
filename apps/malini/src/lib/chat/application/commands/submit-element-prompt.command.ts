import type { BrowserElementPrompt } from '$contract/browser';
import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { mergeFailedComposerSubmissions } from '$lib/chat/domain/composer-submission-recovery';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { errorMessage } from '$lib/chat/domain/error-message';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { defaultAgentModel } from '$shared/providers/providers.api';

export { submitElementPromptCommand };

const ELEMENT_SCREENSHOT_NAME = 'element.png';

function submitElementPromptCommand(
	request: Readonly<{
		requestId: ChatRequestId;
		workstreamId: string;
		picked: BrowserElementPrompt;
	}>,
): void {
	const { requestId, workstreamId, picked } = request;
	void (async () => {
		let screenshot: StagedAgentAttachment | null = null;
		try {
			screenshot = await composerAttachments.stageBytes(
				workstreamId,
				ELEMENT_SCREENSHOT_NAME,
				picked.screenshot.base64,
			);
			await chatBootstrap.settled(workstreamId);
			const sessionId = chatSessionStore.sessionId;
			submitPromptCommand({
				requestId,
				workstreamId,
				sessionId,
				forceFreshSession:
					chatSessionStore.emptySessionMode === 'fresh' ||
					(chatSessionStore.createFreshSessionOnNextPrompt && sessionId !== null),
				prompt: picked.prompt,
				model: chatModelStore.model ?? defaultAgentModel(),
				profile: { ...chatModelStore.profile },
				contextFiles: [],
				attachments: [screenshot],
				issueReferences: [],
				transcriptReferences: [],
				elementReferences: [picked.element],
				automated: false,
			});
			const outcome = await chatRequestsStore.settled(requestId);
			if (outcome.status === 'failed') throw new Error(outcome.error);
		} catch (error) {
			keepInComposer(workstreamId, picked, screenshot);
			toast.error(
				`Element prompt not sent, it is in the composer · ${errorMessage(error, 'Sending failed')}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}

function keepInComposer(
	workstreamId: string,
	picked: BrowserElementPrompt,
	screenshot: StagedAgentAttachment | null,
): void {
	const scope = agentDraftScopeKey(workstreamId, chatSessionStore.sessionId);
	const draft = agentDrafts.draftFor(scope);
	const restored = mergeFailedComposerSubmissions(
		[
			{
				prompt: picked.prompt,
				contextFiles: [],
				attachments: screenshot ? [screenshot] : [],
				issueReferences: [],
				elementReferences: [picked.element],
			},
		],
		{
			prompt: draft.text,
			contextFiles: draft.contextFiles,
			attachments: draft.attachments,
			issueReferences: draft.issueReferences,
			transcriptReferences: draft.transcriptReferences,
			elementReferences: draft.elementReferences,
		},
	);
	agentDrafts.setText(scope, restored.prompt);
	agentDrafts.setAttachments(scope, restored.attachments);
	agentDrafts.setElementReferences(scope, restored.elementReferences ?? []);
}
