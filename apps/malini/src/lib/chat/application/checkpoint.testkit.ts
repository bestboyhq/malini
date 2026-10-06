import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
import {
	WORKSTREAM,
	chat,
	openPromptPipeline,
	rememberChatTurn,
	type PromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import {
	newChatRequestId,
	type ChatRequestId,
	type ChatRequestOutcome,
} from '$lib/chat/domain/chat-request';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import type { CommandName } from '$contract/commands';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';

export const CHECKPOINTED_CHAT = 's-a1';
export const CHECKPOINT = 'cp-1';

export async function openCheckpointedChat(): Promise<PromptPipeline> {
	const pipeline = await openPromptPipeline([chat(CHECKPOINTED_CHAT), chat('s-a2')], {
		agentEvents: {
			[CHECKPOINTED_CHAT]: [
				{
					runId: 'run-1',
					event: { type: 'user.message', text: 'Write a.txt', checkpointId: CHECKPOINT },
				},
				{ runId: 'run-1', event: { type: 'file.changed', path: 'a.txt' } },
				{ runId: 'run-1', event: { type: 'run.completed', summary: 'Wrote a.txt' } },
			],
		},
	});
	rememberChatTurn(CHECKPOINTED_CHAT);
	await sessionActivation.hydrate(CHECKPOINTED_CHAT);
	chatSessionStore.sessionId = CHECKPOINTED_CHAT;
	return pipeline;
}

export function requestId(): ChatRequestId {
	return newChatRequestId();
}

export function outcome(id: ChatRequestId): ChatRequestOutcome | null {
	return chatRequestQuery.data(id);
}

export function settled(id: ChatRequestId): Promise<ChatRequestOutcome> {
	return chatRequestsStore.settled(id);
}

export function callsTo(platform: FakePlatform, command: CommandName): readonly unknown[] {
	return platform.calls.filter((call) => call.command === command).map((call) => call.args);
}

export { WORKSTREAM };
