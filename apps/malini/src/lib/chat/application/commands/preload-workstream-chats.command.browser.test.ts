import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	mountChatHook,
	openChatRoute,
	resetChatState,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { drivePromptQueueHook } from '$lib/chat/application/hooks/drive-prompt-queue.hook';
import {
	recordPromptDelivery,
	rememberChatTurn,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';
import { preloadWorkstreamChatsCommand } from '$lib/chat/application/commands/preload-workstream-chats.command';
import { stopWorkstreamChatsPreloadCommand } from '$lib/chat/application/commands/stop-workstream-chats-preload.command';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
import { forgetRemovedWorkstreamChatsHook } from '$lib/chat/application/hooks/forget-removed-workstream-chats.hook';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';

const ACTIVE = 'ws-active';
const INACTIVE = 'ws-inactive';
const EMPTY = 'ws-empty';

function seededPlatform(): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: 's-active-new', workstreamId: ACTIVE, startedAt: '2026-01-03T00:00:00.000Z' },
			{ id: 's-active-old', workstreamId: ACTIVE, startedAt: '2026-01-01T00:00:00.000Z' },
			{ id: 's-inactive-old', workstreamId: INACTIVE, startedAt: '2026-01-01T00:00:00.000Z' },
			{ id: 's-inactive-new', workstreamId: INACTIVE, startedAt: '2026-01-02T00:00:00.000Z' },
		],
	});
}

function activations(platform: FakePlatform): readonly unknown[] {
	return platform.calls
		.filter((call) => call.command === 'chat.activate-session')
		.map((call) => call.args);
}

afterEach(async () => {
	stopWorkstreamChatsPreloadCommand();
	vi.restoreAllMocks();
	await resetChatState();
});

describe('preloading the chats of every listed workstream', () => {
	it('lists every workstream’s chats, then preactivates only the newest chat of each inactive one', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);

		preloadWorkstreamChatsCommand([ACTIVE, INACTIVE, EMPTY]);

		await vi.waitFor(() => {
			expect(
				workstreamChatsQuery
					.data(ACTIVE)
					.map((chat) => chat.id)
					.sort(),
			).toEqual(['s-active-new', 's-active-old']);
			expect(workstreamChatsQuery.data(INACTIVE)).toHaveLength(2);
		});
		await vi.waitFor(() =>
			expect(activations(platform)).toEqual([{ sessionId: 's-inactive-new' }]),
		);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(activations(platform)).toEqual([{ sessionId: 's-inactive-new' }]);
	});

	it('restores each workstream’s queued prompts and drafts for its sidebar summary', async () => {
		const drafted = 'ws-drafted';
		globalThis.localStorage.setItem(
			`malini.chat.draft-scopes:${drafted}`,
			JSON.stringify([`${drafted}|new`]),
		);
		await openChatRoute(`/workstreams/${ACTIVE}`, seededPlatform());
		expect(workstreamChatSummaryQuery.data(drafted).hasDraft).toBe(false);

		preloadWorkstreamChatsCommand([drafted]);

		expect(workstreamChatSummaryQuery.data(drafted).hasDraft).toBe(true);
		expect(workstreamChatSummaryQuery.data(drafted).state).toEqual({
			label: 'Draft',
			tone: 'draft',
		});
	});

	it('abandons a preload that stopped before its chats were listed', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);

		preloadWorkstreamChatsCommand([INACTIVE]);
		stopWorkstreamChatsPreloadCommand();

		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(workstreamChatsQuery.data(INACTIVE)).toEqual([]);
		expect(activations(platform)).toEqual([]);
	});

	it('lets a newer preload supersede an older one', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);

		preloadWorkstreamChatsCommand([INACTIVE]);
		preloadWorkstreamChatsCommand([ACTIVE]);

		await vi.waitFor(() => expect(workstreamChatsQuery.data(ACTIVE)).toHaveLength(2));
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(workstreamChatsQuery.data(INACTIVE)).toEqual([]);
		expect(activations(platform)).toEqual([]);
	});

	it('forgets the chats and preloaded transcript of a workstream once it is removed', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);
		const stopForgetting = forgetRemovedWorkstreamChatsHook();
		preloadWorkstreamChatsCommand([ACTIVE, INACTIVE]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-inactive-new')).toBe(true),
		);

		platform.emit('repositories:workstream-removed', {
			workstreamId: INACTIVE,
			worktreePath: '/tmp/inactive',
			archived: true,
		});

		expect(workstreamChatsQuery.data(INACTIVE)).toEqual([]);
		expect(sessionsAggregate.isTranscriptHydrated('s-inactive-new')).toBe(false);
		expect(workstreamChatsQuery.data(ACTIVE)).toHaveLength(2);
		stopForgetting();
	});

	it('preloads the transcripts of the first eight workstreams only, leaving the rest to the pointer', async () => {
		const workstreamIds = Array.from({ length: 12 }, (_, index) => `ws-listed-${index}`);
		const platform = createFakePlatform({
			agentSessions: workstreamIds.map((workstreamId) => ({
				id: `s-${workstreamId}`,
				workstreamId,
			})),
		});
		await openChatRoute(`/workstreams/${workstreamIds[0]}`, platform);

		preloadWorkstreamChatsCommand(workstreamIds);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-ws-listed-7')).toBe(true),
		);
		await new Promise((resolve) => setTimeout(resolve, 80));

		const preloaded = platform.calls
			.filter((call) => call.command === 'chat.list-recent-events')
			.map((call) => call.args);
		expect(preloaded).toEqual(
			workstreamIds
				.slice(1, 8)
				.map((workstreamId) => ({ sessionId: `s-${workstreamId}`, byteBudget: 512 * 1024 })),
		);
	});

	it('does not read a held transcript again when the workstream list changes', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);

		preloadWorkstreamChatsCommand([ACTIVE, INACTIVE]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-inactive-new')).toBe(true),
		);
		preloadWorkstreamChatsCommand([ACTIVE, INACTIVE, EMPTY]);
		await vi.waitFor(() =>
			expect(
				platform.calls.filter(
					(call) =>
						call.command === 'chat.list-sessions' &&
						typeof call.args === 'object' &&
						call.args !== null &&
						'workstreamId' in call.args &&
						call.args.workstreamId === EMPTY,
				),
			).toHaveLength(1),
		);
		await new Promise((resolve) => setTimeout(resolve, 80));

		expect(
			platform.calls.filter((call) => call.command === 'chat.list-recent-events'),
		).toHaveLength(1);
	});

	it('sends what was left queued in a listed workstream once the list loads', async () => {
		const platform = seededPlatform();
		await openChatRoute(`/workstreams/${ACTIVE}`, platform);
		mountChatHook(connectAgentEventsHook);
		mountChatHook(drivePromptQueueHook);
		rememberChatTurn('s-inactive-new');
		agentPromptQueue.enqueue({
			workstreamId: INACTIVE,
			targetSessionId: 's-inactive-new',
			prompt: 'Left over from last time',
			model: defaultAgentModel(),
		});
		const sends = recordPromptDelivery();

		preloadWorkstreamChatsCommand([ACTIVE, INACTIVE]);

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({
					sessionId: 's-inactive-new',
					prompt: 'Left over from last time',
				}),
			]),
		);
		agentPromptQueue.clear(INACTIVE);
	});
});
