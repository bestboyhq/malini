import { untrack } from 'svelte';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { notificationService } from '$shared/system/notification.service';

export function showUnreadChatsHook(): () => void {
	return $effect.root(() => {
		const count = $derived(agentActivity.unreadChatCount());
		$effect(() => {
			const shown = count;
			untrack(() => void notificationService.showUnreadCount(shown).catch(() => undefined));
		});
	});
}
