import { toast } from '$hyper-ui/components/toast';
import { checkoutFixPrompt } from '$lib/chat/domain/checkout-fix-prompt';
import { errorMessage } from '$lib/chat/domain/error-message';
import { readNewChatSetup } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { checkoutFixTurnsStore } from '$lib/chat/infrastructure/stores/checkout-fix-turns.store.svelte';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { roleForAgentMode, type ChatSetup } from '$shared/providers/providers.api';
import {
	checkoutHealthQuery,
	workstreamByIdQuery,
	workstreamProjectQuery,
} from '$shared/repositories/repositories.api';

export { askAgentToFixCheckoutCommand };

function askAgentToFixCheckoutCommand(workstreamId: string): void {
	const workstream = workstreamByIdQuery.data(workstreamId);
	if (!workstream || checkoutFixTurnsStore.has(workstreamId)) return;
	const prompt = checkoutFixPrompt({
		folder: workstream.path,
		repository: workstreamProjectQuery.data(workstreamId)?.repoPath ?? null,
		branch: workstream.branch,
		said: checkoutHealthQuery.data(workstreamId).said,
	});
	const { selection, profile } = readNewChatSetup(workstreamId);
	const setup: ChatSetup = { selection, profile: { ...profile, mode: 'agent' } };
	checkoutFixTurnsStore.begin(workstreamId);
	void (async () => {
		try {
			const sessionId = await sessionActivation.mint({ workstreamId, setup, activate: false });
			await promptDelivery.dispatch({
				workstreamId,
				sessionId,
				prompt,
				role: roleForAgentMode(setup.profile.mode),
				provider: selection.provider,
				model: selection.model,
				profile: setup.profile,
				contextFiles: [],
				attachments: [],
				transcriptReferences: [],
				elementReferences: [],
			});
			checkoutFixTurnsStore.seat(workstreamId, sessionId);
		} catch (error) {
			checkoutFixTurnsStore.end(workstreamId);
			toast.error(
				`The agent did not start · ${errorMessage(error, 'the checkout is still broken')}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}
