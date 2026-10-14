import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	installChatPlatform,
	resetChatState,
	settleChatRoute,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { router } from '$shared/router/hash-router.svelte';
import ChatTabs from './ChatTabs.svelte';

const WORKSTREAM = 'ws-tabs';

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	vi.restoreAllMocks();
	await resetChatState();
});

function hydrate(
	sessionId: string,
	origin: 'user' | 'job',
	displayName: string,
	day: number,
): void {
	sessionsAggregate.hydrateSession({
		sessionId,
		workstreamId: WORKSTREAM,
		displayName,
		model: null,
		status: 'idle',
		startedAt: `2026-01-0${day}T00:00:00.000Z`,
		origin,
	});
}

async function renderTabs(path: string, activeSessionId: string): Promise<HTMLElement> {
	installChatPlatform([]);
	await startChatRouter(path);
	hydrate('s-chat', 'user', 'Login flow', 1);
	hydrate('s-job', 'job', 'Fix checks', 2);
	hydrate('s-other-job', 'job', 'Update from main', 3);
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ChatTabs, {
		target: host,
		props: {
			workstreamId: WORKSTREAM,
			activeSessionId,
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

function tabNames(host: HTMLElement): readonly string[] {
	return [...host.querySelectorAll<HTMLElement>('[role="tab"][data-session-id]')].map(
		(tab) => tab.textContent?.trim() ?? '',
	);
}

describe('job transcripts in the chat tabs', () => {
	it('keeps job transcripts out of the tab strip', async () => {
		const host = await renderTabs(`/workstreams/${WORKSTREAM}?agent=s-chat`, 's-chat');

		expect(tabNames(host)).toEqual(['Login flow']);
	});

	it('shows the job the route opens as a tab named for the job', async () => {
		const host = await renderTabs(`/workstreams/${WORKSTREAM}?agent=s-job`, 's-job');

		expect(new Set(tabNames(host))).toEqual(new Set(['Job: Fix checks', 'Login flow']));
		const jobTab = host.querySelector<HTMLElement>('[role="tab"][data-session-id="s-job"]');
		expect(jobTab?.getAttribute('aria-current')).toBe('page');
	});

	it('closes a job tab without closing the job transcript', async () => {
		const archive = vi.spyOn(agentSessions, 'archive');
		const host = await renderTabs(`/workstreams/${WORKSTREAM}?agent=s-job`, 's-job');

		host
			.querySelector<HTMLElement>('[aria-label="Close Job: Fix checks"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await settleChatRoute();

		expect(archive).not.toHaveBeenCalled();
		expect(router.page.url.searchParams.get('agent')).toBe('s-chat');
		expect(tabNames(host)).toEqual(['Login flow']);
	});
});
