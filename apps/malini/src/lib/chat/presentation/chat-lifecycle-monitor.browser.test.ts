import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	holdNavigation,
	navigateChatRoute,
	openChatRoute,
	resetChatState,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentLifecycleMonitor } from '$lib/chat/infrastructure/services/agent-lifecycle-monitor.service';
import ChatLifecycleMonitor from './ChatLifecycleMonitor.svelte';

afterEach(async () => {
	vi.restoreAllMocks();
	agentActivity.reset();
	await resetChatState();
});

function watch(): Readonly<{
	start: ReturnType<typeof vi.spyOn>;
	stop: ReturnType<typeof vi.spyOn>;
	active: ReturnType<typeof vi.spyOn>;
	unmount(): void;
}> {
	const start = vi.spyOn(agentLifecycleMonitor, 'start').mockResolvedValue();
	const stop = vi.spyOn(agentLifecycleMonitor, 'stop').mockImplementation(() => {});
	const active = vi.spyOn(agentLifecycleMonitor, 'setShown');
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ChatLifecycleMonitor, { target: host });
	flushSync();
	return {
		start,
		stop,
		active,
		unmount: () => {
			void unmount(app);
			host.remove();
		},
	};
}

describe('the chat lifecycle monitor', () => {
	it('watches agent lifecycles for as long as the app is mounted', async () => {
		await openChatRoute('/workstreams/ws-a');
		const monitor = watch();

		expect(monitor.start).toHaveBeenCalledTimes(1);
		expect(monitor.active).toHaveBeenLastCalledWith('ws-a', null);
		expect(monitor.stop).not.toHaveBeenCalled();

		monitor.unmount();
		expect(monitor.stop).toHaveBeenCalledTimes(1);
	});

	it('treats the workstream being navigated to as the active one before the route commits', async () => {
		await openChatRoute('/workstreams/ws-a');
		const monitor = watch();
		const hold = holdNavigation(
			(url) => url.hash.includes('ws-b') || url.pathname.includes('ws-b'),
		);

		const navigation = navigateChatRoute('/workstreams/ws-b');
		await vi.waitFor(() => expect(hold.started()).toBe(true));
		flushSync();
		expect(monitor.active).toHaveBeenLastCalledWith('ws-b', null);

		hold.release();
		await navigation;
		expect(monitor.active).toHaveBeenLastCalledWith('ws-b', null);
		monitor.unmount();
	});

	it('reads the chat on screen, and leaves the other chats of the workstream unread', async () => {
		agentActivity.mark('ws-a', {
			kind: 'completed',
			runId: 'run-1',
			sessionId: 's-1',
			updatedAt: 1,
		});
		agentActivity.mark('ws-a', {
			kind: 'completed',
			runId: 'run-2',
			sessionId: 's-2',
			updatedAt: 2,
		});
		await openChatRoute('/workstreams/ws-a?agent=s-1');
		const monitor = watch();

		expect(monitor.active).toHaveBeenLastCalledWith('ws-a', 's-1');
		expect(agentActivity.attentionForChat('s-1')).toBeNull();
		expect(agentActivity.unreadChatsIn('ws-a')).toEqual(['s-2']);
		monitor.unmount();
	});
});
