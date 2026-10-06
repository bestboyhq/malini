import { flushSync, mount, unmount } from 'svelte';
import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { drivePromptQueueHook } from '$lib/chat/application/hooks/drive-prompt-queue.hook';
import ChatSurface from './ChatSurface.svelte';

export type ChatSurfaceHarness = Readonly<{
	host: HTMLElement;
	showWorkstream(workstreamId: string): void;
	stop(): void;
}>;

export function mountChatSurface(
	workstreamId: string,
	host: HTMLElement = document.createElement('div'),
): ChatSurfaceHarness {
	document.body.append(host);
	let releaseAppLevel = (): void => {};
	const stopAppLevel = $effect.root(() => {
		const releaseAgentEvents = connectAgentEventsHook();
		const releasePromptQueue = drivePromptQueueHook();
		releaseAppLevel = () => {
			releasePromptQueue();
			releaseAgentEvents();
		};
	});
	const props = $state({ workstreamId });
	const app = mount(ChatSurface, { target: host, props });
	flushSync();
	return {
		host,
		showWorkstream(next: string): void {
			props.workstreamId = next;
			flushSync();
		},
		stop(): void {
			void unmount(app);
			host.remove();
			stopAppLevel();
			releaseAppLevel();
		},
	};
}
