import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chatSession,
	installChatPlatform,
	resetChatState,
	startChatRouter,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { openNotifiedChatCommand } from '$lib/chat/application/commands/open-notified-chat.command';
import { router } from '$shared/router/hash-router.svelte';
import { workstreamDocuments } from '$shared/shell/workstream-tabs';
import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';

const NOTIFIED = 'ws-notified';
const CREDENTIALS = {
	id: 'src/credentials.ts',
	label: 'credentials.ts',
	icon: 'path:src/credentials.ts',
	tooltip: 'src/credentials.ts',
};

afterEach(async () => {
	await resetChatState();
	workstreamTabs.reset();
});

describe('opening a chat from its notification', () => {
	it.each([
		['from another workstream', '/workstreams/ws-other?agent=s-other'],
		['from the chat the file was opened from', `/workstreams/${NOTIFIED}?agent=s-notified`],
	])('shows the chat over a file tab of its workstream %s', async (_arrival, start) => {
		installChatPlatform([chatSession('s-notified', NOTIFIED), chatSession('s-other', 'ws-other')]);
		await startChatRouter(start);
		workstreamTabs.open(NOTIFIED, CREDENTIALS);

		openNotifiedChatCommand({ workstreamId: NOTIFIED, sessionId: 's-notified' }, () => true);

		await vi.waitFor(() => {
			expect(router.page.params['workstreamId']).toBe(NOTIFIED);
			expect(router.page.url.searchParams.get('agent')).toBe('s-notified');
			expect(workstreamTabs.for(NOTIFIED).activeDocumentId).toBeNull();
		});
		expect(workstreamDocuments(workstreamTabs.for(NOTIFIED)).map(({ id }) => id)).toEqual([
			CREDENTIALS.id,
		]);
	});
});
