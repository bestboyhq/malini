import type { AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { AskingChat } from '$lib/chat/domain/requests-elsewhere';
import { renderInteractionItem, type RenderItem } from './render-state';

export type RequestStep =
	| Readonly<{
			key: string;
			chat: AskingChat;
			kind: 'approval';
			item: Extract<RenderItem, { kind: 'approval' }>;
	  }>
	| Readonly<{
			key: string;
			chat: AskingChat;
			kind: 'questions';
			requests: readonly AgentQuestionRequest[];
	  }>;

export function requestSteps(
	chats: readonly AskingChat[],
	approvalsOf: (sessionId: string) => readonly EventEnvelope[],
	questionsOf: (sessionId: string) => readonly AgentQuestionRequest[],
): RequestStep[] {
	return chats.flatMap((chat): RequestStep[] => {
		const approvals = approvalsOf(chat.sessionId).flatMap((envelope): RequestStep[] => {
			const item = renderInteractionItem(envelope);
			return item?.kind === 'approval' ? [{ key: item.key, chat, kind: 'approval', item }] : [];
		});
		const requests = questionsOf(chat.sessionId);
		if (requests.length === 0) return approvals;
		const key = `questions:${requests.map(({ questionId }) => questionId).join(':')}`;
		return [...approvals, { key, chat, kind: 'questions', requests }];
	});
}
