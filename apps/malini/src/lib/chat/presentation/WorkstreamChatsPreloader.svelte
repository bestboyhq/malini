<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { onWorkstreamLinkIntent } from '$shared/router/workstream-link-intent';
	import { preloadWorkstreamChatsCommand } from '$lib/chat/application/commands/preload-workstream-chats.command';
	import { stopWorkstreamChatsPreloadCommand } from '$lib/chat/application/commands/stop-workstream-chats-preload.command';
	import { warmWorkstreamChatCommand } from '$lib/chat/application/commands/warm-workstream-chat.command';
	import { preloadAttentionChatsHook } from '$lib/chat/application/hooks/preload-attention-chats.hook.svelte';

	interface Props {
		workstreamIds: readonly string[];
	}

	let { workstreamIds }: Props = $props();

	const stopPreloadingAttentionChats = preloadAttentionChatsHook(() => workstreamIds);

	$effect(() => {
		const ids = workstreamIds;
		untrack(() => preloadWorkstreamChatsCommand(ids));
	});

	onMount(() =>
		onWorkstreamLinkIntent((intent) =>
			warmWorkstreamChatCommand(intent.workstreamId, intent.sessionId),
		),
	);

	onDestroy(() => {
		stopPreloadingAttentionChats();
		stopWorkstreamChatsPreloadCommand();
	});
</script>
