import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	deferred,
	mountChatHook,
	navigateChatRoute,
	openChatRoute,
	resetChatState,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { submitComposerPromptCommand } from '$lib/chat/application/commands/submit-composer-prompt.command';
import { preloadWorkstreamChatsCommand } from '$lib/chat/application/commands/preload-workstream-chats.command';
import { stopWorkstreamChatsPreloadCommand } from '$lib/chat/application/commands/stop-workstream-chats-preload.command';
import { warmWorkstreamChatCommand } from '$lib/chat/application/commands/warm-workstream-chat.command';
import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { openNotifiedChatsHook } from '$lib/chat/application/hooks/open-notified-chats.hook';
import { closeChatCommand } from '$lib/chat/application/commands/close-chat.command';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import {
	writeChatModelSnapshot,
	writeStoredRunProfile,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { AgentEvent } from '$lib/chat/domain/events';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { DEFAULT_AGENT_RUN_PROFILE, defaultAgentModel } from '$shared/providers/providers.api';
import { mountChatSurface } from './chat-surface.harness.svelte';
import WorkstreamChatsPreloader from './WorkstreamChatsPreloader.svelte';

const WORKSTREAM = 'ws-surface';

let stop: (() => void) | null = null;

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	stopWorkstreamChatsPreloadCommand();
	stop?.();
	stop = null;
	vi.restoreAllMocks();
	await resetChatState();
});

function render(): HTMLElement {
	const surface = mountChatSurface(WORKSTREAM);
	stop = surface.stop;
	return surface.host;
}

function find(host: HTMLElement, testId: string): HTMLElement | null {
	return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
	const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) =>
			candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name,
	);
	if (!match) throw new Error(`No button named ${name}`);
	return match;
}

function platformWithChats(): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{
				id: 's-planned',
				workstreamId: WORKSTREAM,
				displayName: 'Planning',
				startedAt: '2026-01-02T00:00:00.000Z',
			},
			{
				id: 's-older',
				workstreamId: WORKSTREAM,
				displayName: 'Older chat',
				startedAt: '2026-01-01T00:00:00.000Z',
			},
		],
		agentEvents: {
			's-planned': [
				{ runId: 'run-plan', event: { type: 'user.message', text: 'Plan the endpoint' } },
				{
					runId: 'run-plan',
					event: { type: 'plan.updated', text: '1. Add a health endpoint\n2. Test it' },
				},
				{ runId: 'run-plan', event: { type: 'assistant.message', text: 'Here is the plan' } },
				{ runId: 'run-plan', event: { type: 'run.completed', summary: 'Planned' } },
			],
			's-older': [
				{ runId: 'run-older', event: { type: 'user.message', text: 'Earlier question' } },
				{ runId: 'run-older', event: { type: 'assistant.message', text: 'Earlier answer' } },
				{ runId: 'run-older', event: { type: 'run.completed', summary: 'Answered' } },
			],
		},
	});
}

const NAVIGATION_LOADERS = [
	'workstream-runtime-loader',
	'workstream-navigation-loader',
	'chat-session-loader',
	'workstream-runtime-revalidation',
];

function navigationLoaders(host: HTMLElement): readonly string[] {
	return NAVIGATION_LOADERS.filter((testId) => find(host, testId) !== null);
}

const DESTINATION = 'ws-destination';

type SwitchingSurface = ReturnType<typeof mountChatSurface> & Readonly<{ platform: FakePlatform }>;

function platformWithTwoWorkstreams(): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: 's-source', workstreamId: WORKSTREAM },
			{ id: 's-destination', workstreamId: DESTINATION },
		],
		agentEvents: {
			's-source': [
				{ runId: 'run-source', event: { type: 'user.message', text: 'Source prompt' } },
				{ runId: 'run-source', event: { type: 'run.completed', summary: 'done' } },
			],
			's-destination': [
				{ runId: 'run-destination', event: { type: 'user.message', text: 'Destination prompt' } },
				{ runId: 'run-destination', event: { type: 'run.completed', summary: 'done' } },
			],
		},
	});
}

async function openSourceSurface(
	platform: FakePlatform = platformWithTwoWorkstreams(),
): Promise<SwitchingSurface> {
	await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
	agentRunner.__resetForTests();
	const surface = mountChatSurface(WORKSTREAM);
	stop = surface.stop;
	await vi.waitFor(() => expect(surface.host.textContent).toContain('Source prompt'));
	await settleChatRoute();
	return { ...surface, platform };
}

function knowChatWithoutTranscript(sessionId: string, workstreamId: string): void {
	sessionsAggregate.hydrateSession({
		sessionId,
		workstreamId,
		displayName: sessionId,
		model: null,
		status: 'idle',
		startedAt: '2026-01-01T00:00:00.000Z',
	});
}

const ONE_RUN_BUDGET = 200;

function longDestinationPrompts(runs: number): readonly string[] {
	return Array.from({ length: runs }, (_, index) => `Destination prompt ${index + 1}`);
}

function platformWithLongDestination(runs: number): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: 's-source', workstreamId: WORKSTREAM },
			{ id: 's-destination', workstreamId: DESTINATION },
		],
		agentEvents: {
			's-source': [
				{ runId: 'run-source', event: { type: 'user.message', text: 'Source prompt' } },
				{ runId: 'run-source', event: { type: 'run.completed', summary: 'done' } },
			],
			's-destination': longDestinationPrompts(runs).flatMap((text, index) => [
				{ runId: `run-destination-${index}`, event: { type: 'user.message', text } },
				{
					runId: `run-destination-${index}`,
					event: { type: 'assistant.message', text: `Answer ${index + 1}` },
				},
				{ runId: `run-destination-${index}`, event: { type: 'run.completed', summary: 'done' } },
			]),
		},
	});
}

function platformWithAnOlderLongChat(runs: number): FakePlatform {
	return createFakePlatform({
		agentSessions: [
			{ id: 's-source', workstreamId: WORKSTREAM },
			{
				id: 's-destination-older',
				workstreamId: DESTINATION,
				startedAt: '2026-01-01T00:00:00.000Z',
			},
			{ id: 's-destination', workstreamId: DESTINATION, startedAt: '2026-01-02T00:00:00.000Z' },
		],
		agentEvents: {
			's-source': [
				{ runId: 'run-source', event: { type: 'user.message', text: 'Source prompt' } },
				{ runId: 'run-source', event: { type: 'run.completed', summary: 'done' } },
			],
			's-destination': [
				{ runId: 'run-latest', event: { type: 'user.message', text: 'Latest prompt' } },
				{ runId: 'run-latest', event: { type: 'run.completed', summary: 'done' } },
			],
			's-destination-older': longDestinationPrompts(runs).flatMap((text, index) => [
				{ runId: `run-older-${index}`, event: { type: 'user.message', text } },
				{ runId: `run-older-${index}`, event: { type: 'run.completed', summary: 'done' } },
			]),
		},
	});
}

function holdTranscriptReplay(sessionId: string): () => void {
	const gate = deferred();
	const listEvents = agentSessions.listEvents.bind(agentSessions);
	vi.spyOn(agentSessions, 'listEvents').mockImplementation(async (id, afterSeq) => {
		if (id === sessionId) await gate.promise;
		return listEvents(id, afterSeq);
	});
	return gate.resolve;
}

type ChatSwitchFrame = Readonly<{
	tab: string | null;
	transcript: string | null;
	route: string | null;
	planMode: string | null;
	inertTranscript: boolean;
	loading: boolean;
}>;

function recordChatSwitchFrames(host: HTMLElement): () => readonly ChatSwitchFrame[] {
	const frames: ChatSwitchFrame[] = [];
	const sample = (): void => {
		frames.push({
			tab:
				find(host, 'chat-agent-tabs')?.querySelector<HTMLElement>(
					'[role="tab"][aria-selected="true"][data-session-id]',
				)?.dataset['sessionId'] ?? null,
			transcript:
				find(host, 'chat-message-viewport')?.dataset['sessionId'] ??
				find(host, 'chat-cold-shell')?.dataset['navigationAgentSessionId'] ??
				null,
			route: new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('agent'),
			planMode: find(host, 'chat-plan-mode')?.getAttribute('aria-pressed') ?? null,
			inertTranscript:
				find(host, 'chat-message-viewport') !== null &&
				host.querySelector('[data-session-switching="true"]') !== null,
			loading: find(host, 'chat-cold-shell') !== null,
		});
	};
	const observer = new MutationObserver(sample);
	observer.observe(host, { childList: true, subtree: true, attributes: true });
	return () => {
		observer.disconnect();
		return frames;
	};
}

function chatTab(host: HTMLElement, sessionId: string): HTMLElement {
	const tab = host.querySelector<HTMLElement>(
		`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`,
	);
	if (!tab) throw new Error(`no tab for ${sessionId}`);
	return tab;
}

async function switchToChat(host: HTMLElement, sessionId: string, text: string): Promise<void> {
	chatTab(host, sessionId).click();
	await vi.waitFor(() => {
		expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe(sessionId);
		expect(host.textContent).toContain(text);
	});
	await settleChatRoute();
}

function promptsOnScreen(host: HTMLElement): readonly string[] {
	return [...host.querySelectorAll('[data-testid="chat-message-bubble-user"]')].map(
		(bubble) => bubble.textContent?.trim() ?? '',
	);
}

type TranscriptLayout = Readonly<{
	scrollAwayFromBottom(host: HTMLElement, distance: number): void;
	distanceFromBottom(host: HTMLElement): number;
	scrollTopOf(host: HTMLElement): number;
	scrollPositions(): readonly number[];
	forgetScrollPositions(): void;
}>;

function layOutTranscriptScroller(size: {
	rowHeight: number;
	viewportHeight: number;
}): TranscriptLayout {
	const scrollTops = new WeakMap<Element, number>();
	let written: number[] = [];
	const isScroller = (element: Element): boolean =>
		element.getAttribute('data-testid') === 'chat-message-scroller';
	const contentHeight = (element: Element): number =>
		element.querySelectorAll('[data-testid="chat-message-bubble-user"]').length * size.rowHeight;
	const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get');
	scrollHeight.mockImplementation(function (this: Element): number {
		return isScroller(this) ? Math.max(contentHeight(this), size.viewportHeight) : 0;
	});
	vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (
		this: Element,
	): number {
		return isScroller(this) ? size.viewportHeight : 0;
	});
	vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (
		this: Element,
	): number {
		return scrollTops.get(this) ?? 0;
	});
	vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (
		this: Element,
		value: number,
	): void {
		if (isScroller(this)) written.push(Math.round(value));
		scrollTops.set(this, value);
	});
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
		this: Element,
	): DOMRect {
		const scroller = this.closest('[data-testid="chat-message-scroller"]');
		if (!scroller || !(this instanceof HTMLElement) || this.dataset['runId'] === undefined) {
			return new DOMRect();
		}
		const prompts = [...scroller.querySelectorAll('[data-testid="chat-message-bubble-user"]')];
		const prompt = this.querySelector('[data-testid="chat-message-bubble-user"]');
		const offset = (prompt ? prompts.indexOf(prompt) : prompts.length) * size.rowHeight;
		return new DOMRect(0, offset - (scrollTops.get(scroller) ?? 0), 0, size.rowHeight);
	});
	const scrollerIn = (host: HTMLElement): HTMLElement => {
		const scroller = host.querySelector<HTMLElement>('[data-testid="chat-message-scroller"]');
		if (!scroller) throw new Error('the transcript has no scroller');
		return scroller;
	};
	return {
		scrollAwayFromBottom(host: HTMLElement, distance: number): void {
			const scroller = scrollerIn(host);
			scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }));
			scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - distance);
			scroller.dispatchEvent(new Event('scroll'));
			flushSync();
		},
		distanceFromBottom(host: HTMLElement): number {
			const scroller = scrollerIn(host);
			return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
		},
		scrollTopOf(host: HTMLElement): number {
			return scrollerIn(host).scrollTop;
		},
		scrollPositions: () => written,
		forgetScrollPositions(): void {
			written = [];
		},
	};
}

function framesOnTestClock(): void {
	vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
}

async function afterFrames(count: number): Promise<void> {
	for (let frame = 0; frame < count; frame += 1) {
		vi.advanceTimersToNextFrame();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function withinFrames(assertion: () => void): Promise<void> {
	for (let frame = 0; frame < 120; frame += 1) {
		try {
			assertion();
			return;
		} catch {
			await afterFrames(1);
		}
	}
	assertion();
}

function distanceWhenPromptsAppear(
	host: HTMLElement,
	layout: TranscriptLayout,
	prompts: readonly string[],
): () => number | null {
	let distance: number | null = null;
	const observer = new MutationObserver(() => {
		if (distance !== null) return;
		if (promptsOnScreen(host).join('|') !== prompts.join('|')) return;
		distance = layout.distanceFromBottom(host);
		observer.disconnect();
	});
	observer.observe(host, { childList: true, subtree: true });
	return () => distance;
}

async function openLongDestination(layout: TranscriptLayout): Promise<SwitchingSurface> {
	const surface = await openSourceSurface(platformWithLongDestination(8));
	preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
	await vi.waitFor(() =>
		expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
	);
	await navigateChatRoute(`/workstreams/${DESTINATION}`);
	surface.showWorkstream(DESTINATION);
	await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toEqual(longDestinationPrompts(8)));
	await afterFrames(4);
	expect(layout.distanceFromBottom(surface.host)).toBe(0);
	return surface;
}

function arriveInDestination(platform: FakePlatform, seq: number, event: AgentEvent): void {
	platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: 's-destination',
		runId: 'run-live',
		seq,
		event,
	});
	flushSync();
}

function holdSessionList(workstreamId: string): () => void {
	const gate = deferred();
	const list = agentSessions.list.bind(agentSessions);
	vi.spyOn(agentSessions, 'list').mockImplementation(async (id) => {
		if (id === workstreamId) await gate.promise;
		return list(id);
	});
	return gate.resolve;
}

function selectedChatTab(host: HTMLElement): string | null {
	return (
		host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"][data-session-id]')?.dataset[
			'sessionId'
		] ?? null
	);
}

function composerSubmission(
	workstreamId: string,
	sessionId: string,
	prompt: string,
): Parameters<typeof submitComposerPromptCommand>[0] {
	return {
		draftScope: agentDraftScopeKey(workstreamId, sessionId),
		draftPrompt: prompt,
		freshIntentKey: `${workstreamId}:agent`,
		request: {
			requestId: newChatRequestId(),
			workstreamId,
			sessionId,
			forceFreshSession: false,
			prompt,
			model: defaultAgentModel(),
			profile: { ...DEFAULT_AGENT_RUN_PROFILE },
			contextFiles: [],
			attachments: [],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		},
	};
}

function promptsSent(platform: FakePlatform): readonly unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'chat.send-prompt')
		.map(({ args }) => ({
			sessionId: isRecord(args) ? args['sessionId'] : null,
			prompt: isRecord(args) ? args['prompt'] : null,
		}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

describe('the chat surface', () => {
	it('presents the routed chat transcript on one surface that is never replaced by a loader', async () => {
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platformWithChats());
		const host = render();

		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());

		const surface = find(host, 'workstream-runtime-surface');
		expect(surface?.getAttribute('aria-busy')).toBe('false');
		expect(surface?.dataset['navigationPresentedWorkstreamId']).toBe(WORKSTREAM);
		expect(surface?.dataset['navigationAgentSessionId']).toBe('s-planned');
		expect(find(host, 'transcript-pane')?.dataset['workstreamId']).toBe(WORKSTREAM);
		expect(find(host, 'chat-cold-shell')).toBeNull();
		expect(navigationLoaders(host)).toEqual([]);
		expect(find(host, 'chat-composer')).not.toBeNull();
	});

	it('shows a cold shell under a busy surface while the requested chat is still being verified', async () => {
		const sessionList = deferred();
		const list = agentSessions.list.bind(agentSessions);
		vi.spyOn(agentSessions, 'list').mockImplementation(async (workstreamId) => {
			await sessionList.promise;
			return list(workstreamId);
		});
		await openChatRoute(`/workstreams/${WORKSTREAM}?agent=s-older`, platformWithChats());
		const host = render();
		await settleChatRoute();

		const shell = find(host, 'chat-cold-shell');
		expect(shell).not.toBeNull();
		expect(shell?.dataset['navigationAgentSessionId']).toBe('s-older');
		expect(find(host, 'workstream-runtime-surface')?.getAttribute('aria-busy')).toBe('true');
		expect(navigationLoaders(host)).toEqual([]);

		sessionList.resolve();
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());
		expect(find(host, 'chat-cold-shell')).toBeNull();
	});

	it('shows the destination, never the source transcript, from the first frame of a cold switch', async () => {
		const surface = await openSourceSurface();
		const releaseDestination = holdSessionList(DESTINATION);

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);

		expect(surface.host.textContent).not.toContain('Source prompt');
		expect(find(surface.host, 'transcript-pane')?.dataset['presentedWorkstreamId']).toBe(
			DESTINATION,
		);
		expect(surface.host.querySelector('[data-navigation-retained]')).toBeNull();

		releaseDestination();
		await vi.waitFor(() => expect(surface.host.textContent).toContain('Destination prompt'));
	});

	it('opens a workstream whose chats are known on its latest chat, never on a fresh chat, while it loads', async () => {
		const surface = await openSourceSurface();
		knowChatWithoutTranscript('s-destination', DESTINATION);
		const releaseDestination = holdSessionList(DESTINATION);

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);

		expect(find(surface.host, 'chat-fresh-session')).toBeNull();
		expect(find(surface.host, 'chat-cold-shell')).not.toBeNull();
		expect(surface.host.textContent).not.toContain('Source prompt');
		expect(selectedChatTab(surface.host)).toBe('s-destination');

		releaseDestination();
		await vi.waitFor(() => expect(surface.host.textContent).toContain('Destination prompt'));
		expect(find(surface.host, 'chat-fresh-session')).toBeNull();
	});

	it('opens a workstream never visited since boot on its transcript in the first frame, once its chats are preloaded', async () => {
		const surface = await openSourceSurface();
		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const releaseDestination = holdSessionList(DESTINATION);

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);

		expect(surface.host.textContent).toContain('Destination prompt');
		expect(find(surface.host, 'chat-cold-shell')).toBeNull();
		expect(selectedChatTab(surface.host)).toBe('s-destination');

		releaseDestination();
		await settleChatRoute();
	});

	it('reads only the recent runs of a chat it preloads', async () => {
		const surface = await openSourceSurface();

		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);

		const reads = surface.platform.calls.filter(
			({ command, args }) =>
				isRecord(args) &&
				args['sessionId'] === 's-destination' &&
				(command === 'chat.list-events' || command === 'chat.list-recent-events'),
		);
		expect(reads.map(({ command }) => command)).toEqual(['chat.list-recent-events']);
	});

	it('asks for the chats of an empty workstream once, however often it is warmed', async () => {
		const surface = await openSourceSurface();

		for (let pass = 0; pass < 3; pass += 1) {
			warmWorkstreamChatCommand('ws-empty', null);
			await settleChatRoute();
		}

		expect(
			surface.platform.calls.filter(
				({ command, args }) =>
					command === 'chat.list-sessions' && isRecord(args) && args['workstreamId'] === 'ws-empty',
			),
		).toHaveLength(1);
	});

	it('opens a preloaded chat on its whole history in one step when it fits the budget', async () => {
		const surface = await openSourceSurface(platformWithLongDestination(8));
		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const releaseDestination = holdSessionList(DESTINATION);

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		const firstFrame = promptsOnScreen(surface.host);

		releaseDestination();
		await vi.waitFor(() =>
			expect(sessionActivation.activeRunOwner()?.sessionId).toBe('s-destination'),
		);
		await settleChatRoute();

		expect(firstFrame).toEqual(longDestinationPrompts(8));
		expect(promptsOnScreen(surface.host)).toEqual(firstFrame);
	});

	it('keeps what is on screen in place when older history lands above a preloaded tail', async () => {
		const scroller = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openSourceSurface(platformWithLongDestination(8));
		const readRecent = agentSessions.listRecentEvents.bind(agentSessions);
		vi.spyOn(agentSessions, 'listRecentEvents').mockImplementation((sessionId) =>
			readRecent(sessionId, ONE_RUN_BUDGET),
		);
		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const releaseDestination = holdSessionList(DESTINATION);
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		expect(promptsOnScreen(surface.host)).toEqual(longDestinationPrompts(8).slice(-1));
		scroller.scrollAwayFromBottom(surface.host, 30);

		releaseDestination();
		await vi.waitFor(() =>
			expect(promptsOnScreen(surface.host)).toEqual(longDestinationPrompts(8)),
		);

		expect(scroller.distanceFromBottom(surface.host)).toBe(30);
	});

	it('lands older history above a preloaded tail without replaying arrivals', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
			setTimeout(() => callback(performance.now()), 16),
		);
		vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) =>
			clearTimeout(handle),
		);
		const surface = await openSourceSurface(platformWithLongDestination(8));
		const readRecent = agentSessions.listRecentEvents.bind(agentSessions);
		vi.spyOn(agentSessions, 'listRecentEvents').mockImplementation((sessionId) =>
			readRecent(sessionId, ONE_RUN_BUDGET),
		);
		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const releaseDestination = holdSessionList(DESTINATION);
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const arrivals = vi.spyOn(Element.prototype, 'animate');

		releaseDestination();
		await vi.waitFor(() =>
			expect(promptsOnScreen(surface.host)).toEqual(longDestinationPrompts(8)),
		);
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(arrivals).not.toHaveBeenCalled();
	});

	it('opens a chat whose run is still working without playing any arrival', async () => {
		framesOnTestClock();
		const surface = await openSourceSurface(
			createFakePlatform({
				agentSessions: [
					{ id: 's-source', workstreamId: WORKSTREAM },
					{ id: 's-destination', workstreamId: DESTINATION, status: 'running' },
				],
				agentEvents: {
					's-source': [
						{ runId: 'run-source', event: { type: 'user.message', text: 'Source prompt' } },
						{ runId: 'run-source', event: { type: 'run.completed', summary: 'done' } },
					],
					's-destination': [
						{ runId: 'run-open', event: { type: 'user.message', text: 'Destination prompt' } },
						{ runId: 'run-open', event: { type: 'assistant.message', text: 'Working on it' } },
					],
				},
			}),
		);
		const arrivals = vi.spyOn(Element.prototype, 'animate');

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() => expect(find(surface.host, 'run-status-line')).not.toBeNull());
		await afterFrames(4);

		expect(surface.host.textContent).toContain('Working on it');
		expect(arrivals).not.toHaveBeenCalled();
	});

	it('warms a workstream the pointer is about to open, so it opens on its transcript at once', async () => {
		const surface = await openSourceSurface();
		const preloader = mount(WorkstreamChatsPreloader, {
			target: surface.host,
			props: { workstreamIds: [] },
		});
		flushSync();
		const link = document.createElement('a');
		link.href = `/workstreams/${DESTINATION}`;
		link.dataset['navigationWorkstreamId'] = DESTINATION;
		document.body.append(link);

		link.dispatchEvent(new Event('pointerover', { bubbles: true }));
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const releaseDestination = holdSessionList(DESTINATION);
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);

		expect(surface.host.textContent).toContain('Destination prompt');
		expect(find(surface.host, 'chat-cold-shell')).toBeNull();

		releaseDestination();
		await settleChatRoute();
		void unmount(preloader);
		link.remove();
	});

	it('returns to a visited workstream with its transcript and a ready composer while it revalidates', async () => {
		const surface = await openSourceSurface();
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() => expect(surface.host.textContent).toContain('Destination prompt'));
		await settleChatRoute();
		const releaseSource = holdSessionList(WORKSTREAM);

		await navigateChatRoute(`/workstreams/${WORKSTREAM}`);
		surface.showWorkstream(WORKSTREAM);

		expect(surface.host.textContent).toContain('Source prompt');
		expect(surface.host.textContent).not.toContain('Destination prompt');
		expect(find(surface.host, 'workstream-runtime-surface')?.getAttribute('aria-busy')).toBe(
			'false',
		);
		expect(find(surface.host, 'chat-composer-input')?.getAttribute('aria-disabled')).toBe('false');

		releaseSource();
		await settleChatRoute();
	});

	it('holds a prompt sent during that revalidation until the chat has settled', async () => {
		const surface = await openSourceSurface();
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() => expect(surface.host.textContent).toContain('Destination prompt'));
		await settleChatRoute();
		const releaseSource = holdSessionList(WORKSTREAM);
		await navigateChatRoute(`/workstreams/${WORKSTREAM}`);
		surface.showWorkstream(WORKSTREAM);

		submitComposerPromptCommand(composerSubmission(WORKSTREAM, 's-source', 'Keep going'));
		await settleChatRoute();
		expect(promptsSent(surface.platform)).toEqual([]);

		releaseSource();
		await vi.waitFor(() =>
			expect(promptsSent(surface.platform)).toEqual([
				{ sessionId: 's-source', prompt: 'Keep going' },
			]),
		);
	});

	it('explains a chat that cannot start, copies the error, and retries it', async () => {
		const platform = platformWithChats();
		const list = vi.spyOn(agentSessions, 'list').mockRejectedValue(new Error('runtime offline'));
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		const host = render();

		await vi.waitFor(() => expect(find(host, 'agent-session-error')).not.toBeNull());
		const alert = find(host, 'agent-session-error');
		expect(alert?.getAttribute('role')).toBe('alert');
		expect(find(host, 'agent-session-error-text')?.textContent?.trim()).toBe('runtime offline');
		expect(find(host, 'chat-message-list')).toBeNull();

		button(host, 'Copy session error').click();
		await vi.waitFor(() =>
			expect(
				platform.calls.filter(({ command }) => command === 'app.copy-text').map(({ args }) => args),
			).toEqual([{ text: 'runtime offline' }]),
		);

		list.mockRestore();
		button(host, 'Retry session').click();
		await vi.waitFor(() => expect(find(host, 'agent-session-error')).toBeNull());
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());
	});

	it('puts a rejected prompt back into the composer and says so', async () => {
		const platform = platformWithChats();
		platform.define('chat.send-prompt', async () => {
			throw new Error('provider exploded');
		});
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		agentRunner.__resetForTests();
		const host = render();
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());
		const composerInput = find(host, 'chat-composer-input');
		expect(composerInput?.textContent?.trim()).toBe('');

		submitComposerPromptCommand({
			draftScope: agentDraftScopeKey(WORKSTREAM, 's-planned'),
			draftPrompt: 'Ship the fix',
			freshIntentKey: `${WORKSTREAM}:agent`,
			request: {
				requestId: newChatRequestId(),
				workstreamId: WORKSTREAM,
				sessionId: 's-planned',
				forceFreshSession: false,
				prompt: 'Ship the fix',
				model: defaultAgentModel(),
				profile: { ...DEFAULT_AGENT_RUN_PROFILE },
				contextFiles: [],
				attachments: [],
				issueReferences: [],
				transcriptReferences: [],
				elementReferences: [],
			},
		});

		await vi.waitFor(() =>
			expect(host.textContent).toContain(
				'Prompt could not be sent. Its complete draft was restored.',
			),
		);
		expect(find(host, 'chat-composer-input')?.textContent).toContain('Ship the fix');
	});

	it('stages a forked run transcript in the fork draft only, never in the chat it came from', async () => {
		const platform = await openChatRoute(
			`/workstreams/${WORKSTREAM}?agent=s-planned`,
			platformWithChats(),
		);
		const host = render();
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());
		const chipRemovals = (): readonly string[] =>
			[...(find(host, 'chat-composer-input')?.querySelectorAll('button[aria-label]') ?? [])].map(
				(removal) => removal.getAttribute('aria-label') ?? '',
			);

		const parentDraft = (): string =>
			JSON.stringify(composerDraftQuery.data(agentDraftScopeKey(WORKSTREAM, 's-planned')));
		const draftBeforeFork = parentDraft();
		const activations = (): readonly unknown[] =>
			platform.calls
				.filter(({ command }) => command === 'chat.activate-session')
				.map(({ args }) => (isRecord(args) ? args['sessionId'] : null));
		const activationsBeforeFork = activations().length;

		button(host, 'Fork to new chat').click();
		await vi.waitFor(() => expect(chipRemovals()).toEqual(['Remove Transcript of Planning.md']));
		const fork = selectedChatTab(host);
		expect(fork).not.toBe('s-planned');
		expect(activations().slice(activationsBeforeFork)).toEqual([fork]);
		expect(parentDraft()).toEqual(draftBeforeFork);

		await navigateChatRoute(`/workstreams/${WORKSTREAM}?agent=s-planned`);
		await vi.waitFor(() => expect(selectedChatTab(host)).toBe('s-planned'));
		expect(chipRemovals()).toEqual([]);
	});

	it('offers a new chat the recent transcripts and plans of its workstream as context', async () => {
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platformWithChats());
		const host = render();
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());

		await startFreshChatCommand();
		await settleChatRoute();

		const newChat = selectedChatTab(host);
		expect(['s-planned', 's-older', null]).not.toContain(newChat);
		await vi.waitFor(() => expect(find(host, 'chat-fresh-session')).not.toBeNull());
		const transcripts = host.querySelectorAll('[data-testid="chat-fresh-transcript-suggestion"]');
		expect([...transcripts].map((entry) => entry.textContent?.trim())).toEqual([
			'Planning',
			'Older chat',
		]);
		const plan = find(host, 'chat-fresh-plan-suggestion');
		expect(plan?.textContent?.trim()).toBe('Add a health endpoint');
		expect(plan?.tagName).toBe('BUTTON');
		expect(host.querySelector('[data-testid="chat-fresh-session"] a[href]')).toBeNull();
		expect(find(host, 'chat-message-list')).toBeNull();

		plan?.click();
		flushSync();

		expect(plan?.getAttribute('aria-pressed')).toBe('true');
		expect(
			composerDraftQuery.data(agentDraftScopeKey(WORKSTREAM, newChat)).transcriptReferences,
		).toEqual([{ sessionId: 's-planned', label: 'Plan: Add a health endpoint' }]);
	});

	it('warns that the agent process died and restarts it from the banner', async () => {
		const platform = createFakePlatform({
			agentSessions: [{ id: 's-running', workstreamId: WORKSTREAM, currentRunId: 'run-open' }],
		});
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		let bridgeHealthy = false;
		platform.define('chat.agent-health', async () => bridgeHealthy);
		const host = render();

		await vi.waitFor(() => expect(find(host, 'agent-process-died-banner')).not.toBeNull(), {
			timeout: 5_000,
		});
		const banner = find(host, 'agent-process-died-banner');
		expect(banner?.getAttribute('role')).toBe('status');
		expect(banner?.textContent).toContain('Agent process died');

		bridgeHealthy = true;
		button(host, 'Restart agent process').click();
		flushSync();
		expect(find(host, 'agent-process-died-reset')?.getAttribute('aria-busy')).toBe('true');
		expect(find(host, 'agent-process-died-reset')?.textContent?.trim()).toBe('Restarting…');

		await vi.waitFor(() => expect(find(host, 'agent-process-died-banner')).toBeNull());
		expect(platform.calls.filter(({ command }) => command === 'chat.restart-agent')).toHaveLength(
			1,
		);
	});

	it('shows no agent-died banner while the agent process is healthy', async () => {
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platformWithChats());
		const host = render();
		await vi.waitFor(() => expect(find(host, 'chat-message-list')).not.toBeNull());

		expect(find(host, 'agent-process-died-banner')).toBeNull();
	});
});

describe('the transcript scroller', () => {
	it('opens a chat already at its bottom when switched to, passing through no other scroll position', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openSourceSurface(platformWithLongDestination(8));
		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		const firstFrame = distanceWhenPromptsAppear(surface.host, layout, longDestinationPrompts(8));
		layout.forgetScrollPositions();

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() => expect(firstFrame()).not.toBeNull());
		await afterFrames(20);

		expect(firstFrame()).toBe(0);
		expect(new Set(layout.scrollPositions())).toEqual(new Set([750]));
		expect(layout.distanceFromBottom(surface.host)).toBe(0);
	});

	it('opens a chat already at its bottom when it mounts after loading, passing through no other scroll position', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openSourceSurface(platformWithLongDestination(8));
		const firstFrame = distanceWhenPromptsAppear(surface.host, layout, longDestinationPrompts(8));
		layout.forgetScrollPositions();

		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() => expect(firstFrame()).not.toBeNull());
		await afterFrames(20);

		expect(firstFrame()).toBe(0);
		expect(new Set(layout.scrollPositions())).toEqual(new Set([750]));
	});

	it('glides down to a new prompt that arrives while the reader is at the bottom', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);
		layout.forgetScrollPositions();

		arriveInDestination(surface.platform, 100, {
			type: 'user.message',
			runId: 'run-live',
			text: 'Live prompt',
		});
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Live prompt'));
		await withinFrames(() => expect(layout.distanceFromBottom(surface.host)).toBe(0));

		const positions = layout.scrollPositions();
		expect(positions.some((position) => position > 750 && position < 850)).toBe(true);
	});

	it('leaves a reader who scrolled up where they are when new content arrives', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);
		layout.scrollAwayFromBottom(surface.host, 300);
		const readingAt = layout.scrollTopOf(surface.host);

		arriveInDestination(surface.platform, 100, {
			type: 'user.message',
			runId: 'run-live',
			text: 'Live prompt',
		});
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Live prompt'));
		await afterFrames(40);

		expect(layout.scrollTopOf(surface.host)).toBe(readingAt);
	});

	it('leaves a reader who paged up with the keyboard where they are when new content arrives', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
		arriveInDestination(surface.platform, 100, {
			type: 'user.message',
			runId: 'run-live',
			text: 'Live prompt',
		});
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Live prompt'));
		await afterFrames(40);

		expect(layout.scrollTopOf(surface.host)).toBe(750);
	});

	it('leaves a reader who grabbed the scrollbar where they are when new content arrives', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);

		find(surface.host, 'chat-message-scroller')?.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true }),
		);
		arriveInDestination(surface.platform, 100, {
			type: 'user.message',
			runId: 'run-live',
			text: 'Live prompt',
		});
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Live prompt'));
		await afterFrames(40);

		expect(layout.scrollTopOf(surface.host)).toBe(750);
	});

	it('leaves a reader who scrolled up without the wheel where they are when new content arrives', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);
		const scroller = find(surface.host, 'chat-message-scroller');

		if (scroller) scroller.scrollTop = 500;
		scroller?.dispatchEvent(new Event('scroll'));
		arriveInDestination(surface.platform, 100, {
			type: 'user.message',
			runId: 'run-live',
			text: 'Live prompt',
		});
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Live prompt'));
		await afterFrames(40);

		expect(layout.scrollTopOf(surface.host)).toBe(500);
	});

	it('brings a reader who scrolled up down to the prompt they send themselves', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);
		layout.scrollAwayFromBottom(surface.host, 300);

		submitComposerPromptCommand(composerSubmission(DESTINATION, 's-destination', 'My prompt'));
		await settleChatRoute();

		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('My prompt'));
		await withinFrames(() => expect(layout.scrollTopOf(surface.host)).toBe(850));
	});

	it('leaves a reader who scrolled up where they are when a queued prompt is sent', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		const surface = await openLongDestination(layout);
		arriveInDestination(surface.platform, 100, {
			type: 'run.started',
			runId: 'run-live',
			sessionId: 's-destination',
		});
		submitComposerPromptCommand(composerSubmission(DESTINATION, 's-destination', 'Queued prompt'));
		await settleChatRoute();
		expect(promptsSent(surface.platform)).toEqual([]);
		layout.scrollAwayFromBottom(surface.host, 300);
		const readingAt = layout.scrollTopOf(surface.host);

		arriveInDestination(surface.platform, 101, {
			type: 'run.completed',
			runId: 'run-live',
			summary: 'done',
		});
		await settleChatRoute();
		await vi.waitFor(() =>
			expect(promptsSent(surface.platform)).toEqual([
				{ sessionId: 's-destination', prompt: 'Queued prompt' },
			]),
		);
		await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toContain('Queued prompt'));
		await afterFrames(40);

		expect(layout.scrollTopOf(surface.host)).toBe(readingAt);
	});

	it('opens a chat whose history was never loaded on a loading shell, then at its bottom, never on an empty chat', async () => {
		framesOnTestClock();
		const layout = layOutTranscriptScroller({ rowHeight: 100, viewportHeight: 50 });
		await openChatRoute('/', platformWithAnOlderLongChat(8));
		preloadWorkstreamChatsCommand([DESTINATION]);
		await vi.waitFor(() =>
			expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
		);
		await navigateChatRoute(`/workstreams/${DESTINATION}?agent=s-destination-older`);
		const releaseOlder = holdTranscriptReplay('s-destination-older');
		const host = document.createElement('div');
		const emptyChatShown = vi.fn();
		const watcher = new MutationObserver(() => {
			if (find(host, 'chat-empty-readiness')) emptyChatShown();
		});
		watcher.observe(host, { childList: true, subtree: true });
		const firstFrame = distanceWhenPromptsAppear(host, layout, longDestinationPrompts(8));

		const surface = mountChatSurface(DESTINATION, host);
		stop = surface.stop;
		if (find(host, 'chat-empty-readiness')) emptyChatShown();
		await settleChatRoute();
		expect(find(host, 'chat-cold-shell')).not.toBeNull();

		releaseOlder();
		await vi.waitFor(() => expect(firstFrame()).not.toBeNull());
		await afterFrames(20);
		watcher.disconnect();

		expect(emptyChatShown).not.toHaveBeenCalled();
		expect(firstFrame()).toBe(0);
		expect(new Set(layout.scrollPositions())).toEqual(new Set([750]));
	});
});

describe('switching between the chats of a workstream', () => {
	it('never shows a chat tab selected over another chat, route or composer mode, or an inert chat, in any frame', async () => {
		const platform = platformWithChats();
		writeChatModelSnapshot('s-planned', {
			role: 'planning',
			selection: { model: defaultAgentModel() },
		});
		writeChatModelSnapshot('s-older', {
			role: 'implementation',
			selection: { model: defaultAgentModel() },
		});
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		const host = render();
		await vi.waitFor(() =>
			expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe('s-planned'),
		);
		await settleChatRoute();
		const frames = recordChatSwitchFrames(host);

		await switchToChat(host, 's-older', 'Earlier question');
		await switchToChat(host, 's-planned', 'Plan the endpoint');
		await switchToChat(host, 's-older', 'Earlier question');
		platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
			sessionId: 's-planned',
			runId: 'run-live',
			seq: 100,
			event: { type: 'run.started', runId: 'run-live', sessionId: 's-planned' },
		});
		await settleChatRoute();
		await switchToChat(host, 's-planned', 'Plan the endpoint');

		const switching = frames().filter((frame) => frame.tab !== null);
		expect(switching.length).toBeGreaterThan(0);
		expect(
			switching.filter(
				(frame) =>
					frame.transcript !== frame.tab ||
					frame.route !== frame.tab ||
					frame.planMode !== String(frame.tab === 's-planned') ||
					frame.inertTranscript,
			),
		).toEqual([]);
	});
});

function platformWithOpenChats(count: number): FakePlatform {
	const chats = Array.from({ length: count }, (_, index) => `s-chat-${index + 1}`);
	return createFakePlatform({
		agentSessions: chats.map((id, index) => ({
			id,
			workstreamId: WORKSTREAM,
			displayName: `Chat ${index + 1}`,
			startedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
		})),
		agentEvents: Object.fromEntries(
			chats.map((id, index) => [
				id,
				[
					{ runId: `run-${id}`, event: { type: 'user.message', text: `Question ${index + 1}` } },
					{ runId: `run-${id}`, event: { type: 'run.completed', summary: 'done' } },
				],
			]),
		),
	});
}

function recentReads(platform: FakePlatform): readonly unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'chat.list-recent-events')
		.map(({ args }) => ({
			sessionId: isRecord(args) ? args['sessionId'] : null,
			byteBudget: isRecord(args) ? args['byteBudget'] : null,
		}));
}

async function openLatestOfOpenChats(platform: FakePlatform, latest: string): Promise<HTMLElement> {
	await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
	const host = render();
	await vi.waitFor(() =>
		expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe(latest),
	);
	await settleChatRoute();
	return host;
}

function afterIdlePreload(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 400));
}

describe('the other open chats of a workstream', () => {
	it('opens each of them on its transcript in the first frame, once the current chat has loaded', async () => {
		const host = await openLatestOfOpenChats(platformWithChats(), 's-planned');
		await afterIdlePreload();
		const frames = recordChatSwitchFrames(host);

		chatTab(host, 's-older').click();
		await vi.waitFor(() => expect(host.textContent).toContain('Earlier question'));

		const switching = frames().filter((frame) => frame.tab === 's-older');
		expect(switching.length).toBeGreaterThan(0);
		expect(switching.filter((frame) => frame.loading || frame.transcript !== 's-older')).toEqual(
			[],
		);
	});

	it('reads each other open chat once, within the preload size budget', async () => {
		const platform = platformWithOpenChats(5);
		const host = await openLatestOfOpenChats(platform, 's-chat-5');
		await afterIdlePreload();

		expect(recentReads(platform)).toEqual(
			['s-chat-4', 's-chat-3', 's-chat-2', 's-chat-1'].map((sessionId) => ({
				sessionId,
				byteBudget: 512 * 1024,
			})),
		);

		await switchToChat(host, 's-chat-4', 'Question 4');
		await afterIdlePreload();
		expect(recentReads(platform)).toHaveLength(4);
	});

	it('warms a chat whose tab the pointer is about to open, before the current chat has loaded', async () => {
		const platform = platformWithChats();
		holdTranscriptReplay('s-planned');
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		const host = render();
		const preloader = mount(WorkstreamChatsPreloader, {
			target: host,
			props: { workstreamIds: [] },
		});
		flushSync();
		await vi.waitFor(() => expect(chatTab(host, 's-older')).not.toBeNull());

		chatTab(host, 's-older').dispatchEvent(new Event('pointerover', { bubbles: true }));

		await vi.waitFor(() =>
			expect(recentReads(platform)).toEqual([{ sessionId: 's-older', byteBudget: 512 * 1024 }]),
		);
		void unmount(preloader);
	});

	it('reads nothing when the pointer rests on the tab of a chat already loaded', async () => {
		const platform = platformWithChats();
		const host = await openLatestOfOpenChats(platform, 's-planned');
		const preloader = mount(WorkstreamChatsPreloader, {
			target: host,
			props: { workstreamIds: [] },
		});
		flushSync();

		chatTab(host, 's-planned').dispatchEvent(new Event('pointerover', { bubbles: true }));
		await afterIdlePreload();

		expect(
			recentReads(platform).filter((read) => isRecord(read) && read['sessionId'] === 's-planned'),
		).toEqual([]);
		void unmount(preloader);
	});

	it('drops the warm copy of a chat once it is closed', async () => {
		const host = await openLatestOfOpenChats(platformWithChats(), 's-planned');
		await afterIdlePreload();
		expect(transcriptAggregate.envelopesFor('s-older')).not.toHaveLength(0);

		find(chatTab(host, 's-older').parentElement ?? host, 'chat-agent-tab-close')?.click();

		await vi.waitFor(() => expect(sessionsAggregate.getSession('s-older')).toBeNull());
		expect(sessionsAggregate.listEnvelopesFor('s-older')).toHaveLength(0);
		expect(transcriptAggregate.envelopesFor('s-older')).toHaveLength(0);
	});
});

async function openSourceBesideAttentionChat(): Promise<
	SwitchingSurface & Readonly<{ stopPreloader: () => void }>
> {
	const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
	const preloader = mount(WorkstreamChatsPreloader, {
		target: surface.host,
		props: { workstreamIds: [WORKSTREAM, DESTINATION] },
	});
	flushSync();
	await vi.waitFor(() =>
		expect(sessionsAggregate.isTranscriptHydrated('s-destination')).toBe(true),
	);
	await afterIdlePreload();
	return { ...surface, stopPreloader: () => void unmount(preloader) };
}

async function openedWithoutLoading(
	surface: SwitchingSurface,
	open: () => Promise<void>,
): Promise<readonly ChatSwitchFrame[]> {
	const frames = recordChatSwitchFrames(surface.host);
	await open();
	surface.showWorkstream(DESTINATION);
	await vi.waitFor(() => expect(promptsOnScreen(surface.host)).toEqual(longDestinationPrompts(8)));
	return frames().filter((frame) => frame.tab === 's-destination-older');
}

describe('a chat of another workstream that needs attention', () => {
	it('opens on its transcript in the first frame once it waits for an answer', async () => {
		const surface = await openSourceBesideAttentionChat();
		const releaseHistory = holdTranscriptReplay('s-destination-older');
		surface.platform.emit(CHAT_AGENT_EVENT_CHANNEL, {
			sessionId: 's-destination-older',
			runId: 'run-question',
			seq: 500,
			event: {
				type: 'question.requested',
				runId: 'run-question',
				questionId: 'question-1',
				questions: [
					{
						id: 'q1',
						prompt: 'Which option?',
						options: [{ label: 'A' }, { label: 'B' }],
						multiSelect: false,
						allowFreeText: false,
					},
				],
			},
		});
		await afterIdlePreload();

		const frames = await openedWithoutLoading(surface, () =>
			navigateChatRoute(`/workstreams/${DESTINATION}?agent=s-destination-older`),
		);

		expect(frames.length).toBeGreaterThan(0);
		expect(frames.filter((frame) => frame.loading)).toEqual([]);
		surface.stopPreloader();
		releaseHistory();
	});

	it('opens on its transcript in the first frame once its run failed unseen', async () => {
		const surface = await openSourceBesideAttentionChat();
		const releaseHistory = holdTranscriptReplay('s-destination-older');
		agentActivity.mark(DESTINATION, {
			kind: 'failed',
			runId: 'run-older-7',
			sessionId: 's-destination-older',
			updatedAt: 1,
		});
		await afterIdlePreload();

		const frames = await openedWithoutLoading(surface, () =>
			navigateChatRoute(`/workstreams/${DESTINATION}?agent=s-destination-older`),
		);

		expect(frames.length).toBeGreaterThan(0);
		expect(frames.filter((frame) => frame.loading)).toEqual([]);
		surface.stopPreloader();
		releaseHistory();
	});

	it('opens from its notification on its transcript in the first frame', async () => {
		const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
		mountChatHook(() => openNotifiedChatsHook(() => true));
		const releaseHistory = holdTranscriptReplay('s-destination-older');

		const frames = await openedWithoutLoading(surface, async () => {
			clickNotification(surface.platform, DESTINATION, 's-destination-older');
			await vi.waitFor(() => expect(window.location.hash).toContain('s-destination-older'));
			await settleChatRoute();
		});

		expect(frames.length).toBeGreaterThan(0);
		expect(frames.filter((frame) => frame.loading)).toEqual([]);
		releaseHistory();
	});

	it('opens from its notification after a short wait even when its history is slow', async () => {
		const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
		mountChatHook(() => openNotifiedChatsHook(() => true));
		holdTranscriptReplay('s-destination-older');
		const slowRecent = deferred();
		const readRecent = agentSessions.listRecentEvents.bind(agentSessions);
		vi.spyOn(agentSessions, 'listRecentEvents').mockImplementation(async (sessionId, budget) => {
			if (sessionId === 's-destination-older') await slowRecent.promise;
			return readRecent(sessionId, budget);
		});
		const clickedAt = performance.now();

		clickNotification(surface.platform, DESTINATION, 's-destination-older');

		await vi.waitFor(() => expect(window.location.hash).toContain('s-destination-older'));
		expect(performance.now() - clickedAt).toBeLessThan(400);
		slowRecent.resolve();
	});
});

function clickNotification(platform: FakePlatform, workstreamId: string, sessionId: string): void {
	const clicked = [{ workstreamId, sessionId }];
	platform.define('app.take-notification-target', async () => clicked.shift() ?? null);
	platform.emit('app:notification-opened', { workstreamId, sessionId });
}

function holdChatActivation(sessionId: string): () => void {
	const gate = deferred();
	const activate = agentSessions.activate.bind(agentSessions);
	vi.spyOn(agentSessions, 'activate').mockImplementation(async (id) => {
		if (id === sessionId) await gate.promise;
		return activate(id);
	});
	return gate.resolve;
}

function planModeShown(host: HTMLElement): string | null {
	return find(host, 'chat-plan-mode')?.getAttribute('aria-pressed') ?? null;
}

describe('a mode chosen while a chat is still settling', () => {
	it('stays chosen once the chat it was chosen in finishes activating', async () => {
		const host = await openLatestOfOpenChats(platformWithChats(), 's-planned');
		await afterIdlePreload();
		const releaseActivation = holdChatActivation('s-older');
		chatTab(host, 's-older').click();
		await vi.waitFor(() =>
			expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe('s-older'),
		);
		expect(planModeShown(host)).toBe('false');

		find(host, 'chat-plan-mode')?.click();
		flushSync();
		expect(planModeShown(host)).toBe('true');
		releaseActivation();
		await settleChatRoute();
		await afterIdlePreload();

		expect(planModeShown(host)).toBe('true');
	});

	it('stays chosen once a reopened workstream finishes settling its chat', async () => {
		writeStoredRunProfile(WORKSTREAM, { ...DEFAULT_AGENT_RUN_PROFILE, mode: 'agent' });
		await openLatestOfOpenChats(platformWithChats(), 's-planned');
		stop?.();
		stop = null;
		const releaseActivation = holdChatActivation('s-planned');
		const host = render();
		await vi.waitFor(() =>
			expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe('s-planned'),
		);
		expect(planModeShown(host)).toBe('false');

		find(host, 'chat-plan-mode')?.click();
		flushSync();
		expect(planModeShown(host)).toBe('true');
		releaseActivation();
		await settleChatRoute();
		await afterIdlePreload();

		expect(planModeShown(host)).toBe('true');
	});
});

function holdRecentRead(
	sessionId: string,
): Readonly<{ started: () => boolean; release: () => void }> {
	const gate = deferred();
	let started = false;
	const readRecent = agentSessions.listRecentEvents.bind(agentSessions);
	vi.spyOn(agentSessions, 'listRecentEvents').mockImplementation(async (id, budget) => {
		const recent = readRecent(id, budget);
		if (id === sessionId) {
			started = true;
			await gate.promise;
		}
		return recent;
	});
	return { started: () => started, release: gate.resolve };
}

function routedChat(): Readonly<{ path: string; agent: string | null }> {
	const [path = '', query = ''] = window.location.hash.slice(1).split('?');
	return { path, agent: new URLSearchParams(query).get('agent') };
}

describe('a notification that no longer matches a chat', () => {
	it('opens its workstream, never an error, when its chat was closed', async () => {
		const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
		await navigateChatRoute(`/workstreams/${DESTINATION}`);
		surface.showWorkstream(DESTINATION);
		await vi.waitFor(() =>
			expect(find(surface.host, 'chat-message-viewport')?.dataset['sessionId']).toBe(
				's-destination',
			),
		);
		await settleChatRoute();
		closeChatCommand(DESTINATION, 's-destination-older');
		await vi.waitFor(() => expect(sessionsAggregate.getSession('s-destination-older')).toBeNull());
		mountChatHook(() => openNotifiedChatsHook(() => true));

		clickNotification(surface.platform, DESTINATION, 's-destination-older');
		await afterIdlePreload();
		await settleChatRoute();

		expect(routedChat().path).toBe(`/workstreams/${DESTINATION}`);
		expect(routedChat().agent).not.toBe('s-destination-older');
		expect(find(surface.host, 'agent-session-error')).toBeNull();
		expect(sessionsAggregate.getSession('s-destination-older')).toBeNull();
	});

	it('only brings the app forward when its workstream was removed', async () => {
		const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
		mountChatHook(() => openNotifiedChatsHook((workstreamId) => workstreamId !== DESTINATION));

		clickNotification(surface.platform, DESTINATION, 's-destination-older');
		await afterIdlePreload();

		expect(routedChat().path).toBe(`/workstreams/${WORKSTREAM}`);
	});

	it('opens the chat of the latest of two quick clicks', async () => {
		const surface = await openSourceSurface(platformWithAnOlderLongChat(8));
		mountChatHook(() => openNotifiedChatsHook(() => true));
		const slowRecent = deferred();
		const readRecent = agentSessions.listRecentEvents.bind(agentSessions);
		vi.spyOn(agentSessions, 'listRecentEvents').mockImplementation(async (sessionId, budget) => {
			if (sessionId === 's-destination-older') await slowRecent.promise;
			return readRecent(sessionId, budget);
		});

		clickNotification(surface.platform, DESTINATION, 's-destination-older');
		await new Promise((resolve) => setTimeout(resolve, 20));
		clickNotification(surface.platform, WORKSTREAM, 's-source');
		await afterIdlePreload();
		slowRecent.resolve();
		await afterIdlePreload();

		expect(routedChat()).toEqual({ path: `/workstreams/${WORKSTREAM}`, agent: 's-source' });
	});
});

function platformWithManyWorkstreams(count: number): FakePlatform {
	const ids = Array.from({ length: count }, (_, index) => `ws-many-${index}`);
	return createFakePlatform({
		agentSessions: ids.map((workstreamId) => ({ id: `s-${workstreamId}`, workstreamId })),
		agentEvents: Object.fromEntries(
			ids.map((workstreamId) => [
				`s-${workstreamId}`,
				[
					{ runId: `run-${workstreamId}`, event: { type: 'user.message', text: workstreamId } },
					{ runId: `run-${workstreamId}`, event: { type: 'run.completed', summary: 'done' } },
				],
			]),
		),
	});
}

describe('the warm copies of chats kept in memory', () => {
	it('keeps at most 24 inactive chats warm, dropping the least recently used ones', async () => {
		const platform = platformWithManyWorkstreams(31);
		await openChatRoute('/workstreams/ws-many-0', platform);
		const visits = [1, 7, 13, 19, 25].map((start) =>
			Array.from({ length: 6 }, (_, offset) => `ws-many-${start + offset}`),
		);
		for (const others of visits) {
			preloadWorkstreamChatsCommand(['ws-many-0', ...others]);
			await vi.waitFor(() =>
				expect(others.every((id) => sessionsAggregate.isTranscriptHydrated(`s-${id}`))).toBe(true),
			);
		}

		const warm = sessionsAggregate.hydratedTranscriptSessionIds();
		expect(warm).toHaveLength(24);
		expect(warm).not.toContain('s-ws-many-1');
		expect(warm).toContain('s-ws-many-30');
	});

	it('never keeps a chat whose last run alone is over the budget', async () => {
		const platform = createFakePlatform({
			agentSessions: [
				{ id: 's-source', workstreamId: WORKSTREAM },
				{ id: 's-huge', workstreamId: DESTINATION },
			],
			agentEvents: {
				's-source': [
					{ runId: 'run-source', event: { type: 'user.message', text: 'Source prompt' } },
				],
				's-huge': [
					{ runId: 'run-huge', event: { type: 'user.message', text: 'Huge' } },
					{
						runId: 'run-huge',
						event: { type: 'assistant.message', text: 'x'.repeat(600 * 1024) },
					},
				],
			},
		});
		await openSourceSurface(platform);

		preloadWorkstreamChatsCommand([WORKSTREAM, DESTINATION]);
		await vi.waitFor(() =>
			expect(recentReads(platform)).toEqual([{ sessionId: 's-huge', byteBudget: 512 * 1024 }]),
		);
		await afterIdlePreload();

		expect(sessionsAggregate.isTranscriptHydrated('s-huge')).toBe(false);
		expect(sessionsAggregate.listEnvelopesFor('s-huge')).toHaveLength(0);
	});
});

describe('a warm read shared between preloads', () => {
	it('still lands when the preload that started it was superseded', async () => {
		const platform = platformWithOpenChats(5);
		const slow = holdRecentRead('s-chat-4');
		const host = await openLatestOfOpenChats(platform, 's-chat-5');
		await vi.waitFor(() => expect(slow.started()).toBe(true));

		chatTab(host, 's-chat-3').click();
		await vi.waitFor(() =>
			expect(find(host, 'chat-message-viewport')?.dataset['sessionId']).toBe('s-chat-3'),
		);
		await afterIdlePreload();
		slow.release();

		await vi.waitFor(() => expect(sessionsAggregate.isTranscriptHydrated('s-chat-4')).toBe(true));
	});

	it('never brings back a chat closed while its read was in flight', async () => {
		const platform = platformWithChats();
		const slow = holdRecentRead('s-older');
		const host = await openLatestOfOpenChats(platform, 's-planned');
		await vi.waitFor(() => expect(slow.started()).toBe(true));

		find(chatTab(host, 's-older').parentElement ?? host, 'chat-agent-tab-close')?.click();
		await vi.waitFor(() => expect(sessionsAggregate.getSession('s-older')).toBeNull());
		slow.release();
		await afterIdlePreload();

		expect(sessionsAggregate.getSession('s-older')).toBeNull();
		expect(sessionsAggregate.isTranscriptHydrated('s-older')).toBe(false);
	});
});

describe('the @ mention context picker in the composer', () => {
	const WS = 'ws-at-mention';

	afterEach(() => {
		workstreamFilesAggregate.reset();
	});

	function renderComposer(): HTMLElement {
		const surface = mountChatSurface(WS);
		stop = surface.stop;
		return surface.host;
	}

	function composerInput(host: HTMLElement): HTMLElement {
		const el = host.querySelector<HTMLElement>('[data-testid="chat-composer-input"]');
		if (!el) throw new Error('no chat-composer-input');
		return el;
	}

	function stubEmptySelectionAt(container: Node): () => void {
		const range = document.createRange();
		range.setStart(container, 0);
		range.collapse(true);
		const sel = {
			rangeCount: 1,
			isCollapsed: true,
			getRangeAt: (_index: number) => range,
		};
		const originalGetSelection = window.getSelection.bind(window);
		Object.defineProperty(window, 'getSelection', {
			configurable: true,
			writable: true,
			value: () => sel,
		});
		return () => {
			Object.defineProperty(window, 'getSelection', {
				configurable: true,
				writable: true,
				value: originalGetSelection,
			});
		};
	}

	function fireAtKeydown(input: HTMLElement): void {
		input.focus();
		const event = new KeyboardEvent('keydown', {
			key: '@',
			bubbles: true,
			cancelable: true,
		});
		input.dispatchEvent(event);
		flushSync();
	}

	function findInDoc(testId: string): HTMLElement | null {
		return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	}

	it('opens the context picker when @ is typed at the start of an empty prompt', async () => {
		await openChatRoute(
			`/workstreams/${WS}`,
			createFakePlatform({ workstreamFiles: { [WS]: [] } }),
		);
		const host = renderComposer();
		await vi.waitFor(() =>
			expect(find(host, 'chat-composer-input')?.getAttribute('aria-disabled')).toBe('false'),
		);

		const input = composerInput(host);
		const restore = stubEmptySelectionAt(input);
		try {
			fireAtKeydown(input);
			await tick();
			flushSync();
			await vi.waitFor(() => expect(findInDoc('chat-context-picker')).not.toBeNull());
		} finally {
			restore();
		}
	});

	it('puts the typed @word and the space back in the prompt when space closes the picker', async () => {
		await openChatRoute(
			`/workstreams/${WS}`,
			createFakePlatform({ workstreamFiles: { [WS]: [] } }),
		);
		const host = renderComposer();
		await vi.waitFor(() =>
			expect(find(host, 'chat-composer-input')?.getAttribute('aria-disabled')).toBe('false'),
		);

		const input = composerInput(host);
		const restore = stubEmptySelectionAt(input);
		try {
			fireAtKeydown(input);
			await tick();
			flushSync();
			await vi.waitFor(() => expect(findInDoc('chat-context-picker')).not.toBeNull());

			const search = document.querySelector<HTMLInputElement>(
				'[data-testid="chat-context-search"]',
			);
			if (!search) throw new Error('no chat-context-search');

			search.value = 'noscope';
			search.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			search.dispatchEvent(
				new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
			);
			flushSync();

			await vi.waitFor(() => expect(composerInput(host).textContent).toContain('@noscope '));
		} finally {
			restore();
		}
	});

	it('restores @word to the prompt when Escape is pressed after typing a query', async () => {
		await openChatRoute(
			`/workstreams/${WS}`,
			createFakePlatform({ workstreamFiles: { [WS]: [] } }),
		);
		const host = renderComposer();
		await vi.waitFor(() =>
			expect(find(host, 'chat-composer-input')?.getAttribute('aria-disabled')).toBe('false'),
		);

		const input = composerInput(host);
		const restore = stubEmptySelectionAt(input);
		try {
			fireAtKeydown(input);
			await tick();
			flushSync();
			await vi.waitFor(() => expect(findInDoc('chat-context-picker')).not.toBeNull());

			const search = document.querySelector<HTMLInputElement>(
				'[data-testid="chat-context-search"]',
			);
			if (!search) throw new Error('no chat-context-search');

			search.value = 'noscope';
			search.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			search.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
			);
			flushSync();

			await vi.waitFor(() => expect(composerInput(host).textContent).toContain('@noscope'));
		} finally {
			restore();
		}
	});
});
