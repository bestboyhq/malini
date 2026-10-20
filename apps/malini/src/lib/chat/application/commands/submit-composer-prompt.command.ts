import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { mergeFailedComposerSubmissions } from '$lib/chat/domain/composer-submission-recovery';
import type { ComposerSubmission } from '$lib/chat/domain/composer-submission';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { submitComposerPromptCommand };

function submitComposerPromptCommand(submission: ComposerSubmission): void {
	const request = {
		...submission.request,
		forceFreshSession: composerSubmissionsStore.claimFreshIntent(
			submission.request.forceFreshSession,
			submission.freshIntentKey,
		),
	};
	chatRequestsStore.begin(request.requestId);
	composerSubmissionsStore.enqueue({
		deliver: async () => {
			await chatBootstrap.settled(request.workstreamId);
			submitPromptCommand(request);
			const outcome = await chatRequestsStore.settled(request.requestId);
			const landedIn = chatRequestsStore.takeLanding(request.requestId);
			if (outcome.status !== 'failed') return;
			if (request.forceFreshSession) composerSubmissionsStore.resetFreshIntent();
			const draftScope =
				landedIn === null
					? submission.draftScope
					: agentDraftScopeKey(request.workstreamId, landedIn);
			composerSubmissionsStore.rememberFailure(draftScope, {
				prompt: submission.draftPrompt,
				contextFiles: request.contextFiles,
				attachments: request.attachments,
				transcriptReferences: request.transcriptReferences,
				elementReferences: request.elementReferences,
			});
		},
		whenIdle: restoreFailedDrafts,
	});
}

function restoreFailedDrafts(): void {
	for (const [draftScope, failures] of composerSubmissionsStore.takeFailures()) {
		const current = agentDrafts.draftFor(draftScope);
		const restored = mergeFailedComposerSubmissions(failures, {
			prompt: current.text,
			contextFiles: current.contextFiles,
			attachments: current.attachments,
			transcriptReferences: current.transcriptReferences,
			elementReferences: current.elementReferences,
		});
		agentDrafts.setText(draftScope, restored.prompt);
		agentDrafts.setContextFiles(draftScope, restored.contextFiles);
		agentDrafts.setAttachments(draftScope, restored.attachments);
		agentDrafts.setTranscriptReferences(draftScope, restored.transcriptReferences ?? []);
		agentDrafts.setElementReferences(draftScope, restored.elementReferences ?? []);
		composerSubmissionsStore.markRestored(draftScope);
	}
}
