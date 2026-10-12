<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { onWorkstreamLinkIntent } from '$shared/router/workstream-link-intent';
	import { preloadWorkstreamChatsCommand } from '$lib/chat/application/commands/preload-workstream-chats.command';
	import { renewHeldAttachmentsCommand } from '$lib/chat/application/commands/renew-held-attachments.command';
	import { stopWorkstreamChatsPreloadCommand } from '$lib/chat/application/commands/stop-workstream-chats-preload.command';
	import { warmWorkstreamChatCommand } from '$lib/chat/application/commands/warm-workstream-chat.command';
	import { preloadAttentionChatsHook } from '$lib/chat/application/hooks/preload-attention-chats.hook.svelte';

	interface Props {
		workstreamIds: readonly string[];
	}

	let { workstreamIds }: Props = $props();

	const HELD_ATTACHMENT_RENEWAL_MS = 60 * 60 * 1000;

	const stopPreloadingAttentionChats = preloadAttentionChatsHook(() => workstreamIds);

	$effect(() => {
		const ids = workstreamIds;
		untrack(() => preloadWorkstreamChatsCommand(ids));
	});

	$effect(() => {
		const ids = workstreamIds;
		const timer = setInterval(() => renewHeldAttachmentsCommand(ids), HELD_ATTACHMENT_RENEWAL_MS);
		return () => clearInterval(timer);
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
