import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
import { chatPreparingQuery } from '$lib/chat/application/queries/chat-preparing.query.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	planWorkstreamProvisioning,
	syncWorkstreamsHook,
} from '$shared/repositories/repositories.api';
import { provisioningWorkstreamRow } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import {
	resetChatState,
	mountChatHook,
	openChatRoute,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import {
	WORKSTREAM as PIPELINE_WORKSTREAM,
	openPromptPipeline,
	recordPromptDelivery,
	resetPromptPipeline,
	submission,
	submit,
} from '$lib/chat/application/prompt-pipeline.testkit';
import ChatLifecycleMonitor from '$lib/chat/presentation/ChatLifecycleMonitor.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';
import { removeFailedWorkstreamCommand } from '$shared/repositories/application/commands/remove-failed-workstream.command';
import { provisionWorkstreamCommand } from '$shared/repositories/application/commands/provision-workstream.command';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import { followChatRouteHook } from './follow-chat-route.hook.svelte';

const WORKSTREAM = 'ws-scaffolding';

function listSessionCalls(platform: Awaited<ReturnType<typeof openChatRoute>>): number {
	return platform.calls.filter((call) => call.command === 'chat.list-sessions').length;
}

type HeldSync = Readonly<{ reached: Promise<void>; release: () => void }>;

let pipelinePlatform: FakePlatform | null = null;

async function openSetupPipeline(): ReturnType<typeof openPromptPipeline> {
	const pipeline = await openPromptPipeline([]);
	pipelinePlatform = pipeline.platform;
	await workstreamsAggregate.refresh();
	mountChatHook(syncWorkstreamsHook);
	mountChatHook(() => {
		vi.spyOn(agentLifecycleMonitor, 'start').mockImplementation(() => undefined);
		vi.spyOn(agentLifecycleMonitor, 'stop').mockImplementation(() => undefined);
		const host = document.createElement('div');
		document.body.append(host);
		const monitor = mount(ChatLifecycleMonitor, { target: host });
		return () => {
			void unmount(monitor);
			host.remove();
		};
	});
	return pipeline;
}

function startSetup(workstreamId: string): HeldSync {
	const platform = pipelinePlatform;
	if (!platform) throw new Error('open the setup pipeline first');
	let reached: () => void = () => undefined;
	const reachedSync = new Promise<void>((resolve) => {
		reached = resolve;
	});
	const sync = gate<void>();
	interceptCommand(platform, 'repositories.sync-workstream-base', async () => {
		reached();
		await sync.promise;
	});
	const plan = planWorkstreamProvisioning({
		repo: {
			fullName: 'rabbits/hutch',
			defaultBranch: 'main',
			remoteUrl: 'https://github.com/rabbits/hutch.git',
			localPath: null,
		},
		projects: [
			{
				id: 'local__rabbits__hutch',
				name: 'hutch',
				repoPath: '/tmp/base/rabbits__hutch',
				defaultBranch: 'main',
			},
		],
		workstreamId,
	});
	workstreamsAggregate.stagePendingWorkstream(provisioningWorkstreamRow(plan));
	provisionWorkstreamCommand(plan);
	return { reached: reachedSync, release: () => sync.resolve() };
}

function beginProvisioning(workstreamId: string): void {
	const plan = planWorkstreamProvisioning({
		repo: {
			fullName: 'rabbits/hutch',
			defaultBranch: 'main',
			remoteUrl: 'https://github.com/rabbits/hutch.git',
			localPath: null,
		},
		projects: [],
		workstreamId,
	});
	workstreamsAggregate.stagePendingWorkstream(provisioningWorkstreamRow(plan));
	workstreamProvisioning.begin(plan);
}

function queuedPrompts(workstreamId: string): readonly string[] {
	return agentPromptQueue.entriesFor(workstreamId).map((entry) => entry.prompt);
}

afterEach(async () => {
	vi.restoreAllMocks();
	workstreamProvisioning.reset();
	workstreamsAggregate.reset();
	agentPromptQueue.clear(WORKSTREAM);
	pipelinePlatform = null;
	await resetPromptPipeline();
	await resetChatState();
});

describe('chat boot for a workstream', () => {
	it('boots the chat of a workstream that is still setting up, so its composer is ready at once', async () => {
		const platform = await openChatRoute(`/workstreams/${WORKSTREAM}`);
		beginProvisioning(WORKSTREAM);
		mountChatHook(followChatRouteHook);
		await settleChatRoute();

		expect(workstreamProvisioning.hasPendingWorktree(WORKSTREAM)).toBe(true);
		expect(chatSessionStore.bootstrappedFor).toBe(WORKSTREAM);
		await vi.waitFor(() => expect(listSessionCalls(platform)).toBe(1));
		await vi.waitFor(() => expect(chatPreparingQuery.data).toBe(false));
	});

	it('reads as preparing, not idle, until the boot it started has settled', async () => {
		await openChatRoute(`/workstreams/${WORKSTREAM}`);
		let answerSessions = (): void => {};
		const list = agentSessions.list.bind(agentSessions);
		vi.spyOn(agentSessions, 'list').mockImplementation(async (workstreamId) => {
			await new Promise<void>((resolve) => {
				answerSessions = resolve;
			});
			return list(workstreamId);
		});
		mountChatHook(followChatRouteHook);

		expect(chatSessionStore.bootstrappedFor).toBe(WORKSTREAM);
		expect(chatPreparingQuery.data).toBe(true);
		await settleChatRoute();
		expect(chatPreparingQuery.data).toBe(true);

		answerSessions();
		await vi.waitFor(() => expect(chatPreparingQuery.data).toBe(false));
		expect(chatSessionStore.bootingWorkstreamId).toBeNull();
	});
});

describe('a prompt sent while the workstream is setting up', () => {
	it('waits in the queue, then runs once setup finishes', async () => {
		await openSetupPipeline();
		const sync = startSetup(PIPELINE_WORKSTREAM);
		await sync.reached;
		const sends = recordPromptDelivery();

		await submit(submission({ prompt: 'Start before the checkout exists' }));

		expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual(['Start before the checkout exists']);
		drainPromptQueueCommand(PIPELINE_WORKSTREAM);
		await settleChatRoute();
		expect(sends()).toEqual([]);

		sync.release();

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ prompt: 'Start before the checkout exists' }),
			]),
		);
		await vi.waitFor(() => expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual([]));
	});

	it('runs when setup finishes while no chat is open, and is not sent again when one opens', async () => {
		const pipeline = await openSetupPipeline();
		const sync = startSetup(PIPELINE_WORKSTREAM);
		await sync.reached;
		const sends = recordPromptDelivery();
		await submit(submission({ prompt: 'Sent before leaving for Settings' }));

		pipeline.unmount();
		sync.release();

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ prompt: 'Sent before leaving for Settings' }),
			]),
		);
		await vi.waitFor(() => expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual([]));

		mountChatHook(followChatRouteHook);
		await settleChatRoute();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(sends()).toHaveLength(1);
	});

	it('still runs after a reload lost the setup, once the chat of that workstream boots', async () => {
		await openSetupPipeline();
		const sync = startSetup(PIPELINE_WORKSTREAM);
		await sync.reached;
		const sends = recordPromptDelivery();
		await submit(submission({ prompt: 'Queued before the reload' }));

		workstreamProvisioning.reset();
		mountChatHook(followChatRouteHook);

		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ prompt: 'Queued before the reload' })]),
		);
		sync.release();
	});

	it('holds a prompt for a workstream that does not exist yet, and runs it once it is created', async () => {
		const pipeline = await openSetupPipeline();
		const sends = recordPromptDelivery();
		await submit(submission({ prompt: 'Sent while the checkout was still being made' }));
		mountChatHook(followChatRouteHook);
		await settleChatRoute();

		expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual([
			'Sent while the checkout was still being made',
		]);
		expect(sends()).toEqual([]);

		await pipeline.platform.invoke('repositories.create-workstream', {
			projectRepoPath: '/tmp/base/rabbits__hutch',
			workstreamId: PIPELINE_WORKSTREAM,
			baseBranch: 'main',
			projectId: 'local__rabbits__hutch',
			name: 'Signal Arc',
		});

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ prompt: 'Sent while the checkout was still being made' }),
			]),
		);
	});

	it('does not leave a second prompt waiting behind a first one nothing drains', async () => {
		await openSetupPipeline();
		const sync = startSetup(PIPELINE_WORKSTREAM);
		await sync.reached;
		const sends = recordPromptDelivery();
		await submit(submission({ prompt: 'First' }));
		workstreamProvisioning.reset();

		await submit(submission({ prompt: 'Second' }));

		await vi.waitFor(() => expect(sends().map((sent) => sent.prompt)).toEqual(['First', 'Second']));
		sync.release();
	});

	it('drops the prompts of a failed setup when it is removed, and never sends them', async () => {
		const pipeline = await openSetupPipeline();
		interceptCommand(pipeline.platform, 'repositories.create-workstream', () => {
			throw new Error('fatal: could not add worktree');
		});
		startSetup(PIPELINE_WORKSTREAM);
		await vi.waitFor(() =>
			expect(workstreamProvisioning.get(PIPELINE_WORKSTREAM)?.failure).toBeTruthy(),
		);
		const sends = recordPromptDelivery();
		await submit(submission({ prompt: 'Too early' }));
		expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual(['Too early']);

		removeFailedWorkstreamCommand(PIPELINE_WORKSTREAM);
		await settleChatRoute();

		expect(queuedPrompts(PIPELINE_WORKSTREAM)).toEqual([]);
		expect(sends()).toEqual([]);
	});
});
