import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleChatRoute } from '$lib/chat/application/chat-route.testkit.svelte';
import {
	WORKSTREAM,
	chat,
	openPromptPipeline,
	recordPromptDelivery,
	rememberChatTurn,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import type { AgentAttention } from '$lib/chat/domain/agent-attention';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { page } from '$shared/router/state';
import Inbox from './Inbox.svelte';
import { timeAgo } from './inbox-labels';

const unmounts: Array<() => void> = [];

afterEach(async () => {
	while (unmounts.length > 0) unmounts.pop()?.();
	agentActivity.reset();
	await resetPromptPipeline();
});

function waitingOn(entries: Readonly<Record<string, AgentAttention>>): void {
	agentActivity.registerWorkstreamScope(
		Object.keys(entries).map((workstreamId) => ({
			workstreamId,
			label: `${workstreamId} label`,
			repositoryFullName: `acme/${workstreamId}`,
			branch: `malini/${workstreamId}`,
		})),
	);
	for (const [workstreamId, attention] of Object.entries(entries)) {
		agentActivity.mark(workstreamId, attention);
	}
}

function render(): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(Inbox, { target: host, props: {} });
	flushSync();
	unmounts.push(() => {
		void unmount(app);
		host.remove();
	});
	return host;
}

function named<T extends HTMLElement = HTMLButtonElement>(host: HTMLElement, label: string): T {
	const element = host.querySelector<T>(`[aria-label="${label}"]`);
	if (!element) throw new Error(`Nothing is labelled ${label}`);
	return element;
}

function sections(host: HTMLElement): Record<string, string[]> {
	return Object.fromEntries(
		[...host.querySelectorAll('section')].map((section) => [
			section.querySelector('h2')?.firstChild?.textContent?.trim() ?? '',
			[...section.querySelectorAll('li[aria-label]')].map(
				(row) => row.getAttribute('aria-label') ?? '',
			),
		]),
	);
}

describe('the inbox', () => {
	it('says so when nothing is waiting', () => {
		const host = render();

		expect(host.querySelector('[role="status"]')?.textContent).toContain("You're all caught up");
	});

	it('lists what needs the user above finished turns, with the outcome and the needs', () => {
		waitingOn({
			'ws-done': {
				kind: 'completed',
				runId: 'r1',
				updatedAt: Date.now(),
				outcome: 'The header stays pinned.',
			},
			'ws-asks': {
				kind: 'input',
				runId: 'r2',
				updatedAt: Date.now() - 1_000,
				outcome: 'Uploads go to R2.',
				needs: ['Add R2_TOKEN to .env'],
			},
			'ws-broke': { kind: 'failed', runId: 'r3', updatedAt: Date.now(), body: 'Tests failed' },
		});

		const host = render();

		expect(sections(host)).toEqual({
			'Needs you': ['ws-broke label', 'ws-asks label'],
			Done: ['ws-done label'],
		});
		const asks = named<HTMLElement>(host, 'ws-asks label');
		expect(asks.textContent).toContain('Uploads go to R2.');
		expect(named<HTMLElement>(asks, 'Needs you').textContent).toContain('Add R2_TOKEN to .env');
		expect(named<HTMLElement>(host, 'ws-broke label').textContent).toContain('Tests failed');
	});

	it('forgets an entry the user dismisses', () => {
		waitingOn({ 'ws-done': { kind: 'completed', runId: 'r1', updatedAt: Date.now() } });
		const host = render();

		named(host, 'Dismiss ws-done label').click();
		flushSync();

		expect(agentActivity.attentionFor('ws-done')).toBeNull();
		expect(host.querySelector('[role="status"]')?.textContent).toContain("You're all caught up");
	});

	it('opens the chat the entry came from and clears it', async () => {
		await openPromptPipeline([chat('s-b1', { workstreamId: 'ws-b' })]);
		waitingOn({
			'ws-b': { kind: 'input', runId: 'r1', sessionId: 's-b1', updatedAt: Date.now() },
		});
		const host = render();

		named(host, 'Open ws-b label').click();
		await settleChatRoute();

		expect(page.url.pathname).toBe('/workstreams/ws-b');
		expect(page.url.searchParams.get('agent')).toBe('s-b1');
		expect(agentActivity.attentionFor('ws-b')).toBeNull();
	});

	it('sends a reply to the chat that asked, then clears the entry', async () => {
		await openPromptPipeline([chat('s-a1')]);
		rememberChatTurn('s-a1');
		const sends = recordPromptDelivery();
		waitingOn({
			[WORKSTREAM]: {
				kind: 'input',
				runId: 'r1',
				sessionId: 's-a1',
				updatedAt: Date.now(),
				needs: ['Pick a shadow'],
			},
		});
		const host = render();

		const field = named<HTMLInputElement>(host, `Reply to ${WORKSTREAM} label`);
		field.value = 'Use the softer one';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		named(host, `Send reply to ${WORKSTREAM} label`).click();

		await vi.waitFor(() =>
			expect(sends()).toEqual([
				expect.objectContaining({ sessionId: 's-a1', prompt: 'Use the softer one' }),
			]),
		);
		await vi.waitFor(() => expect(agentActivity.attentionFor(WORKSTREAM)).toBeNull());
	});

	it('shows the first screenshot as a thumbnail that opens the gallery', async () => {
		const platform = createFakePlatform();
		platform.define('repositories.read-workstream-image', async () => ({
			mediaType: 'image/png',
			base64: 'AAAA',
			size: 3,
		}));
		setPlatformForTest(platform);
		waitingOn({
			'ws-done': {
				kind: 'completed',
				runId: 'r1',
				updatedAt: Date.now(),
				images: [{ alt: 'Sticky header', src: '.malini/sandbox/screenshots/header.png' }],
			},
		});
		const host = render();

		await vi.waitFor(() => {
			flushSync();
			named(host, 'Open image Sticky header in gallery').click();
		});
		flushSync();

		expect(document.querySelector('[aria-label="Image gallery"]')).not.toBeNull();
		expect(platform.calls).toContainEqual({
			command: 'repositories.read-workstream-image',
			args: { workstreamId: 'ws-done', path: '.malini/sandbox/screenshots/header.png' },
		});
	});

	it('says how long ago a turn landed', () => {
		const now = 10 * 24 * 60 * 60_000;
		expect(timeAgo(now - 20_000, now)).toBe('just now');
		expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
		expect(timeAgo(now - 3 * 60 * 60_000, now)).toBe('3h ago');
		expect(timeAgo(now - 2 * 24 * 60 * 60_000, now)).toBe('2d ago');
	});
});
