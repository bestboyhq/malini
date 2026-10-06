<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { settleWorkstreamSetupQueueCommand } from '$lib/chat/application/commands/settle-workstream-setup-queue.command';
	import { startChatLifecycleCommand } from '$lib/chat/application/commands/start-chat-lifecycle.command';
	import { stopChatLifecycleCommand } from '$lib/chat/application/commands/stop-chat-lifecycle.command';
	import { watchActiveWorkstreamCommand } from '$lib/chat/application/commands/watch-active-workstream.command';
	import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
	import { drivePromptQueueHook } from '$lib/chat/application/hooks/drive-prompt-queue.hook';
	import { openNotifiedChatsHook } from '$lib/chat/application/hooks/open-notified-chats.hook';
	import { releaseReopenedPromptQueuesHook } from '$lib/chat/application/hooks/release-reopened-prompt-queues.hook.svelte';
	import {
		activeWorkstreamsQuery,
		followWorkstreamSetupHook,
		workstreamsLoadedQuery,
	} from '$shared/repositories/repositories.api';
	import { navigating, page } from '$shared/router/state';

	const workstreams = $derived(activeWorkstreamsQuery.data);
	const workstreamsLoaded = $derived(workstreamsLoadedQuery.data);
	const activeWorkstreamId = $derived(
		navigating.to ? (navigating.to.params.workstreamId ?? '') : (page.params.workstreamId ?? ''),
	);

	$effect(() => {
		watchActiveWorkstreamCommand(activeWorkstreamId);
	});

	const releaseAgentEvents = connectAgentEventsHook();
	const releasePromptQueue = drivePromptQueueHook();
	const stopReleasingReopenedQueues = releaseReopenedPromptQueuesHook();
	const stopFollowingWorkstreamSetup = followWorkstreamSetupHook(settleWorkstreamSetupQueueCommand);
	const stopOpeningNotifiedChats = openNotifiedChatsHook(
		(workstreamId) => !workstreamsLoaded || workstreams.some(({ id }) => id === workstreamId),
	);

	onMount(startChatLifecycleCommand);

	onDestroy(() => {
		stopOpeningNotifiedChats();
		stopFollowingWorkstreamSetup();
		stopReleasingReopenedQueues();
		releasePromptQueue();
		releaseAgentEvents();
		stopChatLifecycleCommand();
	});
</script>
