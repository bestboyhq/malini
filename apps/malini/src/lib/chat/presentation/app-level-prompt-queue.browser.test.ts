import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import {
	recordPromptDelivery,
	rememberChatTurn,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { defaultAgentModel } from '$shared/providers/providers.api';
import ChatLifecycleMonitor from './ChatLifecycleMonitor.svelte';
import { mountChatSurface } from './chat-surface.harness.svelte';

const WORKSTREAM = 'ws-away';
const RUNNING = 's-running';
const RUN = 'run-open';

let stops: Array<() => void> = [];

afterEach(async () => {
	for (const stop of stops.splice(0).reverse()) stop();
	agentPromptQueue.clear(WORKSTREAM);
	vi.restoreAllMocks();
	await resetChatState();
});

async function runningChatAwayFromTheWorkstream(): Promise<FakePlatform> {
	const platform = createFakePlatform({
		agentSessions: [{ id: RUNNING, workstreamId: WORKSTREAM, currentRunId: RUN }],
	});
	setPlatformForTest(platform);
	rememberChatTurn(RUNNING);
	await startChatRouter(`/workstreams/${WORKSTREAM}`);
	vi.spyOn(agentLifecycleMonitor, 'start').mockImplementation(() => undefined);
	vi.spyOn(agentLifecycleMonitor, 'stop').mockImplementation(() => undefined);
	const host = document.createElement('div');
	document.body.append(host);
	const monitor = mount(ChatLifecycleMonitor, { target: host });
	flushSync();
	stops.push(() => {
		void unmount(monitor);
		host.remove();
	});
	const surface = mountChatSurface(WORKSTREAM);
	await vi.waitFor(() => expect(sessionActivation.activeRunOwner()?.sessionId).toBe(RUNNING));
	agentPromptQueue.enqueue({
		workstreamId: WORKSTREAM,
		targetSessionId: RUNNING,
		prompt: 'Next step',
		model: defaultAgentModel(),
	});
	surface.stop();
	await startChatRouter('/');
	await settleChatRoute();
	return platform;
}

function finishTheRun(platform: FakePlatform): void {
	platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: RUNNING,
		runId: RUN,
		seq: 900,
		event: { type: 'run.completed', runId: RUN, summary: 'done' },
	});
}

let sends: () => ReturnType<ReturnType<typeof recordPromptDelivery>> = () => [];

function promptsSentTo(sessionId: string): readonly string[] {
	return sends()
		.filter((input) => input.sessionId === sessionId)
		.map((input) => input.prompt);
}

describe('the prompt queue while no chat is on screen', () => {
	it('starts the prompt queued behind a running run once that run finishes', async () => {
		const platform = await runningChatAwayFromTheWorkstream();
		sends = recordPromptDelivery();
		expect(promptsSentTo(RUNNING)).toEqual([]);

		finishTheRun(platform);

		await vi.waitFor(() => expect(promptsSentTo(RUNNING)).toEqual(['Next step']));
		await vi.waitFor(() => expect(agentPromptQueue.entriesFor(WORKSTREAM)).toEqual([]));
	});

	it('does not send it again when the workstream’s chat opens afterwards', async () => {
		const platform = await runningChatAwayFromTheWorkstream();
		sends = recordPromptDelivery();
		finishTheRun(platform);
		await vi.waitFor(() => expect(promptsSentTo(RUNNING)).toEqual(['Next step']));

		await startChatRouter(`/workstreams/${WORKSTREAM}`);
		const surface = mountChatSurface(WORKSTREAM);
		stops.push(surface.stop);
		await settleChatRoute();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(promptsSentTo(RUNNING)).toEqual(['Next step']);
	});
});
