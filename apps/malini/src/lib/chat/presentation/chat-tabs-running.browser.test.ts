import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	installChatPlatform,
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import ChatTabs from './ChatTabs.svelte';

const WORKSTREAM = 'ws-running-tabs';

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	vi.restoreAllMocks();
	await resetChatState();
});

async function renderTabs(status: SessionRecord['status']): Promise<HTMLElement> {
	installChatPlatform([]);
	await startChatRouter(`/workstreams/${WORKSTREAM}?agent=s-busy`);
	sessionsAggregate.hydrateSession({
		sessionId: 's-busy',
		workstreamId: WORKSTREAM,
		displayName: 'Login flow',
		model: null,
		status,
		startedAt: '2026-01-01T00:00:00.000Z',
		origin: 'user',
	});
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ChatTabs, {
		target: host,
		props: {
			workstreamId: WORKSTREAM,
			activeSessionId: 's-busy',
			fresh: false,
			planMode: false,
			onnewchat: () => undefined,
			onclosefresh: () => undefined,
		},
	});
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
	};
	return host;
}

function click(element: Element | null | undefined): void {
	element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

function button(name: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) => candidate.textContent?.trim() === name,
	);
}

function confirmation(): HTMLElement | null {
	return document.querySelector('[role="dialog"][aria-labelledby]');
}

describe('closing a chat whose agent is still running', () => {
	it('asks first and keeps the agent when the user keeps working', async () => {
		const archive = vi.spyOn(agentSessions, 'archive');
		const host = await renderTabs('running');

		click(host.querySelector('[aria-label="Close Login flow"]'));

		expect(confirmation()?.textContent).toContain('Close running chat');
		click(button('Keep working'));
		await settleChatRoute();

		expect(confirmation()).toBeNull();
		expect(archive).not.toHaveBeenCalled();
	});

	it('asks before Command W closes it, then stops the agent once confirmed', async () => {
		const archive = vi.spyOn(agentSessions, 'archive');
		await renderTabs('waiting_for_approval');

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
		flushSync();

		expect(archive).not.toHaveBeenCalled();
		click(button('Stop and close'));
		await settleChatRoute();

		expect(archive).toHaveBeenCalledWith('s-busy');
	});

	it('closes an idle chat without asking', async () => {
		const archive = vi.spyOn(agentSessions, 'archive');
		const host = await renderTabs('idle');

		click(host.querySelector('[aria-label="Close Login flow"]'));
		await settleChatRoute();

		expect(confirmation()).toBeNull();
		expect(archive).toHaveBeenCalledWith('s-busy');
	});
});
