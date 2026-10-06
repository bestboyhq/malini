import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_RUN_CHANGES_CAPTURED_CHANNEL } from '$contract/events';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import type { AgentSessionChanges } from '$contract/agent';
import {
	resetChatState,
	mountChatHook,
	openChatRoute,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { watchSessionChangesHook } from './watch-session-changes.hook.svelte';

const WORKSTREAM = 'ws-changes';
const SESSION = 'session-changes';
const platform = createFakePlatform();
let answers: Array<(changes: AgentSessionChanges) => void> = [];

function snapshot(paths: readonly string[]): AgentSessionChanges {
	return {
		sessionId: SESSION,
		runs: [],
		files: paths.map((path) => ({ path, additions: 1, deletions: 0, isBinary: false, runIds: [] })),
		beforeCommit: null,
		afterCommit: null,
		capturedAt: null,
	};
}

function terminal(type: 'run.completed' | 'run.failed', runId: string, seq: number): EventEnvelope {
	return {
		sessionId: SESSION,
		runId,
		seq,
		event:
			type === 'run.completed' ? { type, runId, summary: 'done' } : { type, runId, error: 'boom' },
	};
}

async function openActiveChat(): Promise<void> {
	await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
	sessionsAggregate.ensureSession({ sessionId: SESSION, workstreamId: WORKSTREAM, model: null });
	transcriptAggregate.rememberOwner(SESSION, WORKSTREAM);
	transcriptAggregate.ensureProjection(SESSION);
	chatSessionStore.sessionId = SESSION;
	mountChatHook(watchSessionChangesHook);
}

beforeEach(() => {
	answers = [];
	platform.define(
		'chat.session-changes',
		() =>
			new Promise<AgentSessionChanges>((resolve) => {
				answers.push(resolve);
			}),
	);
});

afterEach(async () => {
	await resetChatState();
});

describe('per-chat changed files', () => {
	it('reloads when a run ends even though no capture event arrives', async () => {
		await openActiveChat();
		expect(answers).toHaveLength(1);

		transcriptAggregate.append([terminal('run.completed', 'run-1', 1)]);
		flushSync();
		expect(answers).toHaveLength(2);

		transcriptAggregate.append([terminal('run.failed', 'run-2', 2)]);
		flushSync();
		expect(answers).toHaveLength(3);
	});

	it('reloads on a capture event for this chat and ignores one for another chat', async () => {
		await openActiveChat();
		await settleChatRoute();
		expect(answers).toHaveLength(1);

		platform.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, { sessionId: 'another', runId: 'run-9' });
		flushSync();
		expect(answers).toHaveLength(1);

		platform.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, { sessionId: SESSION, runId: 'run-1' });
		flushSync();
		expect(answers).toHaveLength(2);
	});

	it('keeps the previous snapshot on screen while the reload is in flight', async () => {
		await openActiveChat();
		answers[0]?.(snapshot(['src/first.ts']));
		await vi.waitFor(() =>
			expect(sessionChangesStore.changes?.files.map(({ path }) => path)).toEqual(['src/first.ts']),
		);

		transcriptAggregate.append([terminal('run.completed', 'run-1', 1)]);
		flushSync();
		expect(answers).toHaveLength(2);
		expect(sessionChangesStore.changes?.files.map(({ path }) => path)).toEqual(['src/first.ts']);

		answers[1]?.(snapshot(['src/first.ts', 'src/second.ts']));
		await vi.waitFor(() => expect(sessionChangesStore.changes?.files).toHaveLength(2));
	});
});
