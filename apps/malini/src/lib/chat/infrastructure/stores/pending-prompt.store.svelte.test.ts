import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { pendingPromptStore } from './pending-prompt.store.svelte';

const SESSION: SessionId = 'session-1';

function envelope(runId: string, event: AgentEvent, sessionId: SessionId = SESSION): EventEnvelope {
	return { sessionId, runId, seq: 1, event };
}

function submit(runId: string | null, sessionId: SessionId = SESSION): void {
	pendingPromptStore.set({
		sessionId,
		origin: 'composer',
		runId,
		text: 'do the thing',
		attachments: [],
		issueReferences: [],
	});
}

describe('the prompt this renderer has submitted', () => {
	beforeEach(() => pendingPromptStore.set(null));

	it('is scoped to the transcript it was typed into', () => {
		submit('run-req-1');
		expect(pendingPromptStore.for(SESSION)?.runId).toBe('run-req-1');
		expect(pendingPromptStore.for('session-2')).toBeNull();
	});

	it('gives way to its own persisted history', () => {
		submit('run-req-1');
		pendingPromptStore.clearOnEnvelope(
			envelope('run-req-1', { type: 'user.message', runId: 'run-req-1', text: 'do the thing' }),
		);
		expect(pendingPromptStore.for(SESSION)).toBeNull();
	});

	it('gives way to run.started, which is all the fake runtime ever emits', () => {
		submit('run-req-1');
		pendingPromptStore.clearOnEnvelope(
			envelope('run-req-1', {
				type: 'run.started',
				runId: 'run-req-1',
				sessionId: SESSION,
			}),
		);
		expect(pendingPromptStore.for(SESSION)).toBeNull();
	});

	it('stays put while another run in the same transcript reports itself', () => {
		submit('run-req-1');
		pendingPromptStore.clearOnEnvelope(
			envelope('run-other', { type: 'run.started', runId: 'run-other', sessionId: SESSION }),
		);
		pendingPromptStore.clearOnEnvelope(
			envelope('run-other', { type: 'user.message', runId: 'run-other', text: 'a queued turn' }),
		);
		expect(pendingPromptStore.for(SESSION)?.runId).toBe('run-req-1');
	});

	it('falls back to clearing on any run when its own run id is unknown', () => {
		submit(null);
		pendingPromptStore.clearOnEnvelope(
			envelope('run-other', { type: 'run.started', runId: 'run-other', sessionId: SESSION }),
		);
		expect(pendingPromptStore.for(SESSION)).toBeNull();
	});

	it('is dropped outright when its send fails', () => {
		submit('run-req-1');
		pendingPromptStore.clearForSession(SESSION);
		expect(pendingPromptStore.for(SESSION)).toBeNull();
	});

	it('keeps each transcript’s prompt when another transcript submits one', () => {
		submit('run-req-1');
		submit('run-req-2', 'session-2');

		expect(pendingPromptStore.for(SESSION)?.runId).toBe('run-req-1');
		expect(pendingPromptStore.for('session-2')?.runId).toBe('run-req-2');

		pendingPromptStore.clearForSession('session-2');

		expect(pendingPromptStore.for(SESSION)?.runId).toBe('run-req-1');
	});
});
