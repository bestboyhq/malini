import { vi } from 'vitest';
import {
	deferred,
	mountChatHook,
	resetChatState,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { appendEnvelopesCommand } from '$lib/chat/application/commands/append-envelopes.command';
import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { drivePromptQueueHook } from '$lib/chat/application/hooks/drive-prompt-queue.hook';
import { newChatRequestId, type ChatRequestOutcome } from '$lib/chat/domain/chat-request';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { PromptSubmission } from '$lib/chat/domain/prompt-submission';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { writeChatModelSnapshot } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import type { FakeAgentSessionSeed, PlatformSeed } from '$shared/port/fake/seed';
import { setPlatformForTest } from '$shared/port/platform';
import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_MODEL_PREFERENCES,
	defaultAgentModel,
	saveModelDefaultsCommand,
	type AgentModel,
	type ModelRole,
} from '$shared/providers/providers.api';

export const WORKSTREAM = 'ws-a';
export const SIBLING_WORKSTREAM = 'ws-b';

let nextSeq = 1_000;

export function chat(
	id: string,
	overrides: Partial<FakeAgentSessionSeed> = {},
): FakeAgentSessionSeed {
	return {
		id,
		workstreamId: WORKSTREAM,
		displayName: id,
		startedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

export type PromptPipeline = Readonly<{
	platform: FakePlatform;
	unmount: () => void;
}>;

export async function openPromptPipeline(
	sessions: readonly FakeAgentSessionSeed[],
	seed: PlatformSeed = {},
): Promise<PromptPipeline> {
	const platform = createFakePlatform({ ...seed, agentSessions: sessions });
	setPlatformForTest(platform);
	agentRunner.__resetForTests();
	await startChatRouter(`/workstreams/${WORKSTREAM}`);
	const disconnect = mountChatHook(connectAgentEventsHook);
	const stopQueue = mountChatHook(drivePromptQueueHook);
	await agentEventStream.ensureStarted();
	for (const workstreamId of new Set(sessions.map((session) => session.workstreamId))) {
		await sessionActivation.refreshSessionTabs(workstreamId);
	}
	return {
		platform,
		unmount: () => {
			stopQueue();
			disconnect();
		},
	};
}

export function rememberChatTurn(
	sessionId: string,
	role: ModelRole = 'implementation',
	model: AgentModel = defaultAgentModel(),
): void {
	writeChatModelSnapshot(sessionId, { role, selection: { model } });
}

export function submission(overrides: Partial<PromptSubmission> = {}): PromptSubmission {
	return {
		workstreamId: WORKSTREAM,
		sessionId: null,
		forceFreshSession: false,
		prompt: 'Ship the fix',
		model: defaultAgentModel(),
		profile: { ...DEFAULT_AGENT_RUN_PROFILE },
		contextFiles: [],
		attachments: [],
		issueReferences: [],
		transcriptReferences: [],
		elementReferences: [],
		...overrides,
	};
}

export async function submit(input: PromptSubmission): Promise<void> {
	const outcome = await submitAndSettle(input);
	if (outcome.status === 'failed') throw new Error(outcome.error);
}

export function submitAndSettle(input: PromptSubmission): Promise<ChatRequestOutcome> {
	const requestId = newChatRequestId();
	submitPromptCommand({ ...input, requestId });
	return chatRequestsStore.settled(requestId);
}

export function deliverRunEvent(sessionId: string, runId: string, event: AgentEvent): void {
	nextSeq += 1;
	appendEnvelopesCommand([{ sessionId, runId, seq: nextSeq, event }]);
}

export function startRun(sessionId: string, runId = `${sessionId}-held`): void {
	deliverRunEvent(sessionId, runId, { type: 'run.started', runId, sessionId });
}

export function completeRun(sessionId: string, runId = `${sessionId}-held`): void {
	deliverRunEvent(sessionId, runId, { type: 'run.completed', runId, summary: 'done' });
}

export type HeldCall<TInput> = Readonly<{
	calls: () => readonly TInput[];
	release: () => void;
	fail: (reason: unknown) => void;
}>;

type PromptDelivery = Parameters<typeof agentSessions.sendPrompt>[0];

export function holdPromptDelivery(): HeldCall<PromptDelivery> {
	const gate = deferred();
	const deliver = agentSessions.sendPrompt.bind(agentSessions);
	const send = vi.spyOn(agentSessions, 'sendPrompt').mockImplementation(async (input) => {
		await gate.promise;
		return deliver(input);
	});
	return {
		calls: () => send.mock.calls.map(([input]) => input),
		release: () => gate.resolve(),
		fail: (reason) => gate.reject(reason),
	};
}

export function recordPromptDelivery(): () => readonly PromptDelivery[] {
	const send = vi.spyOn(agentSessions, 'sendPrompt');
	return () => send.mock.calls.map(([input]) => input);
}

export async function resetPromptPipeline(): Promise<void> {
	vi.useRealTimers();
	vi.restoreAllMocks();
	saveModelDefaultsCommand(DEFAULT_MODEL_PREFERENCES);
	chatModelStore.adoptDefaults();
	await resetChatState();
	for (const workstreamId of [WORKSTREAM, SIBLING_WORKSTREAM]) agentPromptQueue.clear(workstreamId);
	pendingPromptStore.set(null);
	chatRequestsStore.reset();
	composerSubmissionsStore.reset();
	chatModelStore.model = null;
	chatModelStore.profile = { ...DEFAULT_AGENT_RUN_PROFILE };
}
