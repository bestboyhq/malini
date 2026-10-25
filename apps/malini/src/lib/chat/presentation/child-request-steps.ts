import type { AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
import type { AskingChild } from '$lib/chat/domain/child-requests';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { renderInteractionItem, type RenderItem } from './render-state';

export type ChildRequestStep =
	| Readonly<{
			key: string;
			child: AskingChild;
			kind: 'approval';
			item: Extract<RenderItem, { kind: 'approval' }>;
	  }>
	| Readonly<{
			key: string;
			child: AskingChild;
			kind: 'questions';
			requests: readonly AgentQuestionRequest[];
	  }>;

export function childRequestSteps(
	children: readonly AskingChild[],
	approvalsOf: (sessionId: string) => readonly EventEnvelope[],
	questionsOf: (sessionId: string) => readonly AgentQuestionRequest[],
): ChildRequestStep[] {
	return children.flatMap((child): ChildRequestStep[] => {
		const approvals = approvalsOf(child.sessionId).flatMap((envelope): ChildRequestStep[] => {
			const item = renderInteractionItem(envelope);
			return item?.kind === 'approval' ? [{ key: item.key, child, kind: 'approval', item }] : [];
		});
		const requests = questionsOf(child.sessionId);
		if (requests.length === 0) return approvals;
		const key = `questions:${requests.map(({ questionId }) => questionId).join(':')}`;
		return [...approvals, { key, child, kind: 'questions', requests }];
	});
}
