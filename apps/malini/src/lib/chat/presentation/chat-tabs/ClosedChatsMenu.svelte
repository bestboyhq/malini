<script lang="ts">
	import { loadClosedChatsCommand } from '$lib/chat/application/commands/load-closed-chats.command';
	import { reopenChatCommand } from '$lib/chat/application/commands/reopen-chat.command';
	import { closedChatsQuery } from '$lib/chat/application/queries/closed-chats.query.svelte';
	import { closedAgo } from '$lib/chat/domain/closed-chat';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();
	let open = $state(false);
	let nowMs = $state(Date.now());
	const chats = $derived(closedChatsQuery.data(workstreamId));

	$effect(() => loadClosedChatsCommand(workstreamId));

	function onOpenChange(next: boolean): void {
		if (!next) return;
		nowMs = Date.now();
		loadClosedChatsCommand(workstreamId);
	}
</script>

<Dropdown
	bind:open
	{onOpenChange}
	side="bottom"
	align="start"
	role={null}
	panelClass="w-72"
	testId="chat-closed-menu"
>
	{#snippet trigger()}
		<Tooltip
			content="Recently closed · ⌘⇧T"
			placement="top"
			suppressed={open}
			class="size-7 shrink-0 items-center justify-center"
		>
			<IconButton
				bare
				ariaLabel="Recently closed chats"
				ariaHasPopup="menu"
				ariaExpanded={open}
				class={[
					'hover:bg-tab-hover hover:text-fg-default focus-visible:ring-button-primary/40 relative grid size-5 cursor-pointer place-items-center rounded-full outline-none before:absolute before:-inset-1 before:content-[""] focus-visible:ring-2 focus-visible:ring-inset',
					open ? 'bg-tab-hover text-fg-default' : 'text-fg-tertiary',
				]}
				data-testid="chat-closed-trigger"
			>
				<Icon name="clock" size={14} />
			</IconButton>
		</Tooltip>
	{/snippet}
	{#snippet content()}
		<div role="menu" aria-label="Recently closed chats">
			{#each chats as chat (chat.id)}
				<DropdownItem
					role="menuitem"
					class="gap-3"
					data-testid="chat-closed-item"
					data-session-id={chat.id}
					onSelect={() => reopenChatCommand(workstreamId, chat.id)}
				>
					<span class="min-w-0 flex-1 truncate text-left">
						<SensitiveText text={chat.name} interactive={false} />
					</span>
					<span class="text-fg-tertiary shrink-0 text-xs tabular-nums">
						{closedAgo(chat.closedAt, nowMs)}
					</span>
				</DropdownItem>
			{:else}
				<p class="text-fg-tertiary px-2.5 py-1.5 text-xs text-balance">
					Go ship something cool. Closed chats will be there in case you need them.
				</p>
			{/each}
		</div>
	{/snippet}
</Dropdown>
