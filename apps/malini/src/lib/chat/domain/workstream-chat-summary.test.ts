import { describe, expect, it } from 'vitest';
import type { AgentAttentionKind } from './agent-attention';
import type { SessionRecord } from './session-record';
import { summarizeWorkstreamChat } from './workstream-chat-summary';

function summary(kind: AgentAttentionKind): ReturnType<typeof summarizeWorkstreamChat> {
	return summarizeWorkstreamChat({
		session: null,
		openingSessionId: null,
		jobRunning: false,
		queueCount: 0,
		attention: { kind, runId: 'run-1', sessionId: 'chat-1', updatedAt: 1 },
		hasDraft: false,
	});
}

const runningChat: SessionRecord = {
	id: 'running-chat',
	workstreamId: 'workstream-1',
	displayName: 'Running chat',
	model: null,
	status: 'running',
	currentRunId: null,
	lastError: null,
	startedAt: '2026-10-14T10:00:00.000Z',
	origin: 'user',
};

describe('the unread mark of a workstream', () => {
	it('names a turn that needs the user as waiting on them', () => {
		expect(summary('input').state).toEqual({ label: 'Needs you', tone: 'waiting' });
	});

	it('marks only the turns that need the user, never a turn that simply finished', () => {
		expect(summary('input').needsYou).toBe(true);
		expect(summary('approval').needsYou).toBe(true);
		expect(summary('failed').needsYou).toBe(true);
		expect(summary('completed').needsYou).toBe(false);
		expect(summary('completed').state).toEqual({ label: 'Ready', tone: 'completed' });
	});
});

describe('the chat a workstream opens on', () => {
	const chat = (openingSessionId: string | null) =>
		summarizeWorkstreamChat({
			session: runningChat,
			openingSessionId,
			jobRunning: false,
			queueCount: 0,
			attention: null,
			hasDraft: false,
		});

	it('returns to the chat the user last visited while another chat runs', () => {
		expect(chat('visited-chat').sessionId).toBe('visited-chat');
		expect(chat('visited-chat').state).toEqual({ label: 'Running', tone: 'running' });
	});

	it('falls back to the busiest chat before the user has visited one', () => {
		expect(chat(null).sessionId).toBe('running-chat');
	});
});
