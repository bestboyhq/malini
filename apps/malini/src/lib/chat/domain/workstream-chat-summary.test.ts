import { describe, expect, it } from 'vitest';
import type { AgentAttention, AgentAttentionKind } from './agent-attention';
import type { BackgroundWait } from './background-work';
import type { SessionRecord } from './session-record';
import { summarizeWorkstreamChat } from './workstream-chat-summary';

function summary(kind: AgentAttentionKind): ReturnType<typeof summarizeWorkstreamChat> {
	return summarizeWorkstreamChat({
		session: null,
		openingSessionId: null,
		backgroundWait: null,
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
			backgroundWait: null,
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

describe('the loader of a workstream with only background work', () => {
	const state = (
		session: SessionRecord | null,
		backgroundWait: BackgroundWait | null,
		jobRunning: boolean,
		overrides: { queueCount?: number; attention?: AgentAttention } = {},
	) =>
		summarizeWorkstreamChat({
			session,
			openingSessionId: null,
			backgroundWait,
			jobRunning,
			queueCount: 0,
			attention: null,
			hasDraft: false,
			...overrides,
		}).state;

	it('keeps the background loader while a background agent still works', () => {
		expect(state(runningChat, 'agents', false)).toEqual({
			label: 'Background agents running',
			tone: 'background',
		});
	});

	it('reads a chat that only waits on its background commands as a finished turn', () => {
		const needsYou = {
			kind: 'input',
			runId: 'run-1',
			sessionId: 'running-chat',
			updatedAt: 1,
		} as const;
		expect(state(runningChat, 'commands', false)).toEqual({ label: 'Ready', tone: 'completed' });
		expect(state(runningChat, 'commands', false, { attention: needsYou })).toEqual({
			label: 'Needs you',
			tone: 'waiting',
		});
		expect(state(runningChat, 'commands', false, { queueCount: 2 })).toEqual({
			label: '2 queued',
			tone: 'queued',
		});
		expect(state(runningChat, 'commands', true)).toEqual({
			label: 'Job running',
			tone: 'background',
		});
	});

	it('shows a job running behind an idle chat as background work', () => {
		expect(state(null, null, true)).toEqual({ label: 'Job running', tone: 'background' });
	});

	it('keeps the working loader while the chat itself works beside a job', () => {
		expect(state(runningChat, null, true)).toEqual({ label: 'Running', tone: 'running' });
	});
});
