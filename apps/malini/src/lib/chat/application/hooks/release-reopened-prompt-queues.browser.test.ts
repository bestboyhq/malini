import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountChatHook, settleChatRoute } from '$lib/chat/application/chat-route.testkit.svelte';
import {
	WORKSTREAM,
	chat,
	completeRun,
	holdPromptDelivery,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
	startRun,
	submission,
	submit,
	submitAndSettle,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';
import ChatLifecycleMonitor from '$lib/chat/presentation/ChatLifecycleMonitor.svelte';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';
import type { FakeWorkstream, PlatformSeed } from '$shared/port/fake/seed';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';

const PROJECT = { id: 'p-hutch', name: 'hutch', repoPath: '/tmp/hutch', defaultBranch: 'main' };

function workstreamRow(
	id: string,
	checkoutState: FakeWorkstream['checkoutState'] = 'healthy',
): FakeWorkstream {
	return {
		id,
		projectId: PROJECT.id,
		name: id,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		checkoutState,
	};
}

async function openAppWithoutChat(seed: PlatformSeed): Promise<FakePlatform> {
	const pipeline = await openPromptPipeline([chat('s-a1')], seed);
	rememberChatTurn('s-a1');
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
	return pipeline.platform;
}

function queued(): readonly string[] {
	return agentPromptQueue.entriesFor(WORKSTREAM).map((entry) => entry.prompt);
}

afterEach(async () => {
	vi.restoreAllMocks();
	workstreamsAggregate.reset();
	agentPromptQueue.clear(WORKSTREAM);
	await resetPromptPipeline();
});

describe('a prompt queue whose workstream could not take prompts for a while', () => {
	it('runs once an archive is undone, even when the run it waited on ended during the undo window', async () => {
		await openAppWithoutChat({ projects: [PROJECT], workstreams: [workstreamRow(WORKSTREAM)] });
		await workstreamsAggregate.refresh();
		startRun('s-a1');
		const sends = recordPromptDelivery();
		await submit(submission({ sessionId: 's-a1', prompt: 'After the archive' }));
		workstreamRetirementStore.retire({
			workstreamId: WORKSTREAM,
			commit: async () => undefined,
			undoWindowMs: 60_000,
		});

		completeRun('s-a1');
		await settleChatRoute();
		expect(sends()).toEqual([]);
		expect(queued()).toEqual(['After the archive']);

		workstreamRetirementStore.undo(WORKSTREAM);

		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ prompt: 'After the archive' })]),
		);
	});

	it('sends at once when the workstream list failed to load, instead of queueing silently', async () => {
		const platform = await openAppWithoutChat({
			projects: [PROJECT],
			workstreams: [workstreamRow(WORKSTREAM)],
		});
		platform.define('repositories.list-workstreams', async () => {
			throw new Error('the database is locked');
		});
		await workstreamsAggregate.refresh();
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1', prompt: 'Despite the list' }));

		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ prompt: 'Despite the list' })]),
		);
	});

	it('runs a prompt held for a missing workstream once a later list load finds it', async () => {
		const platform = await openAppWithoutChat({ projects: [PROJECT], workstreams: [] });
		await workstreamsAggregate.refresh();
		const sends = recordPromptDelivery();
		await submit(submission({ sessionId: 's-a1', prompt: 'Once it exists' }));
		await settleChatRoute();
		expect(sends()).toEqual([]);

		platform.seed({ workstreams: [workstreamRow(WORKSTREAM)] });
		await workstreamsAggregate.refresh();

		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ prompt: 'Once it exists' })]),
		);
	});

	it('holds a prompt while the workstream checkout is missing, and sends it once a refresh finds the checkout again', async () => {
		const platform = await openAppWithoutChat({
			projects: [PROJECT],
			workstreams: [workstreamRow(WORKSTREAM, 'missing')],
		});
		await workstreamsAggregate.refresh();
		const sends = recordPromptDelivery();

		await submit(submission({ sessionId: 's-a1', prompt: 'Once the checkout is back' }));
		await settleChatRoute();
		expect(sends()).toEqual([]);
		expect(queued()).toEqual(['Once the checkout is back']);

		platform.seed({ workstreams: [workstreamRow(WORKSTREAM, 'healthy')] });
		await workstreamsAggregate.refresh();

		await vi.waitFor(() =>
			expect(sends()).toEqual([expect.objectContaining({ prompt: 'Once the checkout is back' })]),
		);
	});

	it('never sends a prompt queued behind a run once the checkout turns out unusable', async () => {
		const platform = await openAppWithoutChat({
			projects: [PROJECT],
			workstreams: [workstreamRow(WORKSTREAM)],
		});
		await workstreamsAggregate.refresh();
		startRun('s-a1');
		const sends = recordPromptDelivery();
		await submit(submission({ sessionId: 's-a1', prompt: 'Behind the run' }));

		platform.seed({ workstreams: [workstreamRow(WORKSTREAM, 'not-a-checkout')] });
		await workstreamsAggregate.refresh();
		completeRun('s-a1');
		await settleChatRoute();

		expect(sends()).toEqual([]);
		expect(queued()).toEqual(['Behind the run']);
	});

	it('never sends a queued prompt while the prompt before it is still being delivered', async () => {
		await openAppWithoutChat({ projects: [PROJECT], workstreams: [workstreamRow(WORKSTREAM)] });
		await workstreamsAggregate.refresh();
		const delivery = holdPromptDelivery();
		const first = submitAndSettle(submission({ sessionId: 's-a1', prompt: 'First' }));
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));

		await submit(submission({ sessionId: 's-a1', prompt: 'Second' }));
		await settleChatRoute();

		expect(delivery.calls().map((call) => call.prompt)).toEqual(['First']);
		expect(queued()).toEqual(['Second']);
		delivery.release();
		await first;
	});
});
