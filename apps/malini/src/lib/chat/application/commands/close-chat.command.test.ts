import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeChatCommand } from '$lib/chat/application/commands/close-chat.command';
import { closingChatsQuery } from '$lib/chat/application/queries/closing-chats.query.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { toast } from '$hyper-ui/components/toast';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform({
		agentSessions: [{ id: 's-1', workstreamId: 'ws-a' }],
	});
	setPlatformForTest(platform);
	sessionsAggregate.ensureSession({ sessionId: 's-1', workstreamId: 'ws-a', model: null });
	return platform;
}

afterEach(() => {
	vi.restoreAllMocks();
	sessionsAggregate.reset();
	setPlatformForTest(null);
});

describe('closing a chat tab', () => {
	it('hides the tab at once, archives the chat, then forgets it without a toast', async () => {
		const platform = installPlatform();
		const info = vi.spyOn(toast, 'info');

		closeChatCommand('ws-a', 's-1');

		expect(closingChatsQuery.data.has('s-1')).toBe(true);
		await vi.waitFor(() => expect(closingChatsQuery.data.has('s-1')).toBe(false));
		expect(platform.calls).toContainEqual({
			command: 'chat.archive-session',
			args: { sessionId: 's-1' },
		});
		expect(sessionsAggregate.getSession('s-1')).toBeNull();
		expect(info).not.toHaveBeenCalled();
	});

	it('brings the tab back and says why when the chat cannot be archived', async () => {
		const platform = installPlatform();
		platform.define('chat.archive-session', async () => {
			throw new Error('cannot archive agent session `s-1` while a run is active');
		});
		const error = vi.spyOn(toast, 'error');

		closeChatCommand('ws-a', 's-1');

		await vi.waitFor(() => expect(closingChatsQuery.data.has('s-1')).toBe(false));
		expect(sessionsAggregate.getSession('s-1')).not.toBeNull();
		expect(error).toHaveBeenCalledWith(
			'Could not close agent chat · cannot archive agent session `s-1` while a run is active',
			{ context: { workstream: 'ws-a' } },
		);
	});
});
