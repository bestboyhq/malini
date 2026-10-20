import { afterEach, describe, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { sessionEnvelopesQuery } from './session-envelopes.query.svelte';

const RETAINED: EventEnvelope = {
	sessionId: 'session-retained',
	runId: 'run-1',
	seq: 1,
	event: { type: 'user.message', runId: 'run-1', text: 'from the previous workstream' },
};

describe('the envelopes a chat session owns', () => {
	afterEach(() => transcriptAggregate.reset());

	it('are empty without a session, even while another transcript stays on screen', () => {
		transcriptAggregate.replace('session-retained', [RETAINED]);
		transcriptAggregate.retainedPresentation = {
			workstreamId: 'ws-previous',
			sessionId: 'session-retained',
		};

		expect(sessionEnvelopesQuery.data(null)).toEqual([]);
	});

	it('are the session transcript once a session is selected', () => {
		transcriptAggregate.replace('session-retained', [RETAINED]);

		expect(sessionEnvelopesQuery.data('session-retained')).toEqual([RETAINED]);
	});
});
