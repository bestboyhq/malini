import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { buildImplementationHandoffPrompt } from '$lib/chat/domain/plan-implementation-handoff';
import type { SessionId } from '$lib/chat/domain/session';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { writeStoredRunProfile } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { selectionForRole, type AgentRunProfile } from '$shared/providers/providers.api';

export { implementPlanCommand };

type PlanHandoff = Readonly<{
	requestId: ChatRequestId;
	workstreamId: string;
	plan: string;
	sourceSessionId: SessionId;
	sourceRunId: string;
}>;

function implementPlanCommand(handoff: PlanHandoff): void {
	chatRequestsStore.begin(handoff.requestId);
	void (async () => {
		try {
			await implementPlan(handoff);
			chatRequestsStore.accept(handoff.requestId);
		} catch (error) {
			const message = errorMessage(error, 'Plan could not be implemented');
			chatRequestsStore.fail(handoff.requestId, message);
			toast.error(
				`Could not start the implementation chat · ${message}`,
				aboutWorkstream(handoff.workstreamId),
			);
		}
	})();
}

async function implementPlan(input: PlanHandoff): Promise<void> {
	const workstreamId = input.workstreamId;
	if (
		chatRoute.workstreamId !== workstreamId ||
		transcriptAggregate.ownerOf(input.sourceSessionId) !== workstreamId
	) {
		throw new Error('The source plan no longer belongs to this workstream');
	}
	const sourceUserEnvelope = findLastEnvelope(
		transcriptAggregate.envelopesFor(input.sourceSessionId),
		(envelope) => envelope.runId === input.sourceRunId && envelope.event.type === 'user.message',
	);
	const sourceUser =
		sourceUserEnvelope?.event.type === 'user.message' ? sourceUserEnvelope.event : null;
	const selection = selectionForRole(chatModelStore.rememberedModels, 'implementation');
	const implementationProfile: AgentRunProfile = {
		mode: 'agent',
		effort: chatModelStore.profile.effort,
		access: chatModelStore.profile.access,
	};
	const handoffPrompt = buildImplementationHandoffPrompt({
		plan: input.plan,
		originalRequest: sourceUser?.text ?? null,
	});
	chatModelStore.model = selection.model;
	chatModelStore.profile = implementationProfile;
	chatModelStore.rememberRoleSelection('implementation', selection);
	writeStoredRunProfile(workstreamId, implementationProfile);
	const sessionId = await sessionActivation.mint({
		workstreamId,
		role: 'implementation',
		selection,
		activate: true,
	});
	await promptDelivery.dispatch({
		workstreamId,
		sessionId,
		prompt: handoffPrompt,
		role: 'implementation',
		model: selection.model,
		profile: implementationProfile,
		contextFiles: sourceUser?.contextFiles ?? [],
		attachments: sourceUser?.attachments ?? [],
		issueReferences: [],
		transcriptReferences: [],
		elementReferences: [],
		automated: true,
	});
}

function findLastEnvelope(
	envelopes: readonly EventEnvelope[],
	predicate: (envelope: EventEnvelope) => boolean,
): EventEnvelope | undefined {
	for (let index = envelopes.length - 1; index >= 0; index -= 1) {
		const envelope = envelopes[index];
		if (envelope && predicate(envelope)) return envelope;
	}
	return undefined;
}
