import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
import { presentedTranscriptQuery } from '$lib/chat/application/queries/presented-transcript.query.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import {
	resetChatState,
	mountChatHook,
	navigateChatRoute,
	openChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { connectAgentEventsHook } from './connect-agent-events.hook';
import { followChatRouteHook } from './follow-chat-route.hook.svelte';

const SOURCE = 'ws-source';
const DESTINATION = 'ws-destination';

function seededPlatform(): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: 'session-source', workstreamId: SOURCE },
			{ id: 'session-destination', workstreamId: DESTINATION },
		],
		agentEvents: {
			'session-source': [
				{ runId: 'run-source', event: { type: 'user.message', text: 'source prompt' } },
				{ runId: 'run-source', event: { type: 'assistant.message', text: 'source answer' } },
			],
			'session-destination': [
				{ runId: 'run-destination', event: { type: 'user.message', text: 'destination' } },
			],
		},
	});
}

function holdSessionListFor(workstreamId: string): () => void {
	let answer = (): void => {};
	const held = new Promise<void>((resolve) => {
		answer = resolve;
	});
	const list = agentSessions.list.bind(agentSessions);
	vi.spyOn(agentSessions, 'list').mockImplementation(async (id) => {
		if (id === workstreamId) await held;
		return list(id);
	});
	return answer;
}

afterEach(async () => {
	await resetChatState();
	vi.restoreAllMocks();
});

describe('cold workstream switch', () => {
	it('never presents the source transcript under the destination route', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${SOURCE}`, platform);
		mountChatHook(connectAgentEventsHook);
		mountChatHook(followChatRouteHook);
		await vi.waitFor(() =>
			expect(presentedTranscriptQuery.data).toMatchObject({
				workstreamId: SOURCE,
				sessionId: 'session-source',
				envelopes: [{ seq: 1 }, { seq: 2 }],
			}),
		);

		const answerDestination = holdSessionListFor(DESTINATION);
		await navigateChatRoute(`/workstreams/${DESTINATION}`);

		expect(presentedTranscriptQuery.data).toEqual({
			workstreamId: DESTINATION,
			sessionId: null,
			envelopes: [],
		});
		expect(activeSessionQuery.data).toBeNull();

		answerDestination();
		await vi.waitFor(() =>
			expect(presentedTranscriptQuery.data).toMatchObject({
				workstreamId: DESTINATION,
				sessionId: 'session-destination',
				envelopes: [{ seq: 1 }],
			}),
		);
	});
});
