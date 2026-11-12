import { describe, expect, it } from 'vitest';
import { ProviderInteractionBroker } from '../provider-interactions';
import type { AgentEvent } from '../types';

const QUESTION = {
	id: 'question-1:0',
	prompt: 'Which runner?',
	options: [{ label: 'Vitest' }],
	multiSelect: false,
	allowFreeText: false,
};

describe('provider interaction broker', () => {
	it('tells Malini when Claude Code withdraws a request nobody answered', async () => {
		const events: AgentEvent[] = [];
		const broker = new ProviderInteractionBroker({
			sessionId: 'session',
			emit: (event) => events.push(event),
		});
		const approval = new AbortController();
		const question = new AbortController();
		const answered = new AbortController();
		const approved = broker.requestApproval({
			runId: 'run',
			approvalId: 'approval-1',
			reason: 'Run outside the sandbox',
			signal: approval.signal,
		});
		const asked = broker.requestQuestion({
			runId: 'run',
			questionId: 'question-1',
			questions: [QUESTION],
			signal: question.signal,
		});
		const kept = broker.requestApproval({
			runId: 'run',
			approvalId: 'approval-2',
			reason: 'Read a file',
			signal: answered.signal,
		});
		broker.resolveApproval({
			sessionId: 'session',
			runId: 'run',
			approvalId: 'approval-2',
			decision: 'allow',
			scope: 'once',
		});
		approval.abort();
		question.abort();
		answered.abort();

		await expect(approved).resolves.toMatchObject({ decision: 'deny', reason: 'request-aborted' });
		await expect(asked).resolves.toEqual({ behavior: 'cancelled', reason: 'request-aborted' });
		await expect(kept).resolves.toMatchObject({ decision: 'allow' });
		expect(events.filter(({ type }) => type.endsWith('.withdrawn'))).toEqual([
			{ type: 'approval.withdrawn', runId: 'run', approvalId: 'approval-1' },
			{ type: 'question.withdrawn', runId: 'run', questionId: 'question-1' },
		]);
	});
});
