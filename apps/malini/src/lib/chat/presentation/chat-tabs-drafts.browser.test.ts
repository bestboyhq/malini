import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
	installChatPlatform,
	resetChatState,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import ChatTabs from './ChatTabs.svelte';

const WORKSTREAM = 'ws-drafts';
const DRAFTED = agentDraftScopeKey(WORKSTREAM, 's-drafted');

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	agentDrafts.clear(DRAFTED);
	await resetChatState();
});

function hydrate(sessionId: string, displayName: string, day: number): void {
	sessionsAggregate.hydrateSession({
		sessionId,
		workstreamId: WORKSTREAM,
		displayName,
		model: null,
		status: 'idle',
		startedAt: `2026-01-0${day}T00:00:00.000Z`,
		origin: 'user',
	});
}

async function renderTabs(): Promise<HTMLElement> {
	installChatPlatform([]);
	await startChatRouter(`/workstreams/${WORKSTREAM}?agent=s-clean`);
	hydrate('s-drafted', 'Login flow', 1);
	hydrate('s-clean', 'Pricing page', 2);
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ChatTabs, {
		target: host,
		props: {
			workstreamId: WORKSTREAM,
			activeSessionId: 's-clean',
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

function tabDescription(host: HTMLElement, sessionId: string): string | null {
	const tab = host.querySelector<HTMLElement>(`[role="tab"][data-session-id="${sessionId}"]`);
	const describedBy = tab?.getAttribute('aria-describedby');
	return describedBy ? (document.getElementById(describedBy)?.textContent ?? null) : null;
}

describe('unsent drafts in the chat tabs', () => {
	it('marks the tab of a chat holding an unsent message until it is cleared', async () => {
		const host = await renderTabs();
		expect(tabDescription(host, 's-drafted')).toBeNull();

		updateDraftCommand(DRAFTED, { text: 'half a thought' });
		flushSync();

		expect(tabDescription(host, 's-drafted')).toBe('Unsent draft');
		expect(tabDescription(host, 's-clean')).toBeNull();

		agentDrafts.clear(DRAFTED);
		flushSync();

		expect(tabDescription(host, 's-drafted')).toBeNull();
	});
});
