import { flushSync } from 'svelte';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';
import { transcriptAnchors } from '$lib/chat/infrastructure/stores/transcript-anchors.store';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import type { FakeAgentEventSeed, FakeAgentSessionSeed } from '$shared/port/fake/seed';
import { setPlatformForTest } from '$shared/port/platform';
import { router, type RouteNode } from '$shared/router/hash-router.svelte';
import { goto } from '$shared/router/navigation';

const fixturePage = () => import('$shared/router/fixtures/FixturePage.svelte');

const routes: RouteNode = {
	segment: '',
	page: fixturePage,
	children: [
		{
			segment: 'workstreams',
			children: [{ segment: ':workstreamId', page: fixturePage }],
		},
	],
};

export type Deferred = Readonly<{
	promise: Promise<void>;
	resolve(): void;
	reject(reason: unknown): void;
}>;

const pendingGates: Array<() => void> = [];
const mounted = new Set<() => void>();

export function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	pendingGates.push(resolve);
	return { promise, resolve, reject };
}

export type NavigationHold = Readonly<{
	started(): boolean;
	release(): void;
}>;

export function holdNavigation(matches: (url: URL) => boolean): NavigationHold {
	const gate = deferred();
	let started = false;
	const unsubscribe = router.onNavigate((navigation) => {
		if (!navigation.to || !matches(navigation.to.url)) return;
		started = true;
		return gate.promise;
	});
	pendingGates.push(unsubscribe);
	return { started: () => started, release: () => gate.resolve() };
}

export function chatSession(
	id: string,
	workstreamId: string,
	startedAt = '2026-01-01T00:00:00.000Z',
): FakeAgentSessionSeed {
	return { id, workstreamId, displayName: id, startedAt };
}

export function chatTranscript(sessionId: string): readonly FakeAgentEventSeed[] {
	const runId = `${sessionId}-run`;
	return [
		{ runId, event: { type: 'user.message', runId, text: `prompt in ${sessionId}` } },
		{ runId, event: { type: 'assistant.message', runId, text: `answer in ${sessionId}` } },
	];
}

export function envelope(sessionId: string, seq: number): EventEnvelope {
	const runId = `${sessionId}-run`;
	return {
		sessionId,
		runId,
		seq,
		event: { type: 'assistant.message', runId, text: `${sessionId} #${seq}` },
	};
}

export function installChatPlatform(sessions: readonly FakeAgentSessionSeed[]): FakePlatform {
	const platform = createFakePlatform({
		agentSessions: sessions,
		agentEvents: Object.fromEntries(
			sessions.map((session) => [session.id, chatTranscript(session.id)]),
		),
	});
	setPlatformForTest(platform);
	return platform;
}

export async function startChatRouter(path: string): Promise<void> {
	window.history.replaceState(null, '', `#${path}`);
	router.start({
		routes,
		notFound: () => import('$shared/router/fixtures/FixtureNotFound.svelte'),
	});
	await settleChatRoute();
}

export async function openChatRoute(
	path: string,
	platform: FakePlatform = createFakePlatform(),
): Promise<FakePlatform> {
	setPlatformForTest(platform);
	await startChatRouter(path);
	return platform;
}

export async function navigateChatRoute(path: string): Promise<void> {
	await goto(path, { replaceState: true });
	await settleChatRoute();
}

export async function settleChatRoute(): Promise<void> {
	for (let attempt = 0; attempt < 50 && router.navigating; attempt += 1) {
		await router.navigating.complete;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
	flushSync();
}

export function mountChatHook(hook: () => () => void): () => void {
	let release: (() => void) | null = null;
	const destroy = $effect.root(() => {
		release = hook();
	});
	flushSync();
	const unmount = (): void => {
		if (!mounted.delete(unmount)) return;
		destroy();
		release?.();
	};
	mounted.add(unmount);
	return unmount;
}

export async function resetChatState(): Promise<void> {
	for (const unmount of [...mounted]) unmount();
	chatSessionStore.reset();
	for (const release of pendingGates.splice(0)) release();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	router.stop();
	await agentEventStream.__resetForTests();
	promptDelivery.__resetForTests();
	agentRunner.__resetForTests();
	chatSessionStore.reset();
	transcriptAggregate.reset();
	sessionsAggregate.reset();
	sessionChangesStore.reset();
	transcriptAnchors.reset();
	setPlatformForTest(null);
	globalThis.localStorage?.clear();
}
