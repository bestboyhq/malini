<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import type { OverflowTab } from './overflow-tabs';

	interface Props {
		tabs: readonly OverflowTab[];
		open?: boolean;
	}

	let { tabs, open = $bindable(false) }: Props = $props();
	let query = $state('');
	let filterInput = $state<HTMLInputElement | null>(null);
	const filteredTabs = $derived(tabs.filter((tab) => fuzzyMatch(tab.name, query)));

	$effect(() => {
		if (!open) {
			query = '';
			return;
		}
		void focusFilter();
	});

	async function focusFilter(): Promise<void> {
		await tick();
		filterInput?.focus();
	}

	function fuzzyMatch(value: string, search: string): boolean {
		const needle = search.trim().toLocaleLowerCase();
		if (!needle) return true;
		const haystack = value.toLocaleLowerCase();
		let offset = 0;
		for (const character of needle) {
			offset = haystack.indexOf(character, offset);
			if (offset < 0) return false;
			offset += 1;
		}
		return true;
	}
</script>

<Dropdown bind:open side="bottom" align="end" testId="chat-agent-overflow-menu">
	{#snippet trigger()}
		<Button
			variant="ghost"
			size="md"
			class="text-fg-tertiary h-7 gap-1 text-xs focus-visible:ring-inset"
			ariaLabel={`${tabs.length} more chats and files`}
			ariaHasPopup="menu"
			ariaExpanded={open}
			data-testid="chat-agent-overflow"
		>
			<Icon name="more" size={14} />
			<span>{tabs.length}</span>
		</Button>
	{/snippet}
	{#snippet content()}
		<div class="w-64 p-1" role="menu" aria-label="More chats and files">
			<label class="bg-surface-150 text-fg-tertiary mb-1 flex items-center gap-2 rounded-md px-2">
				<Icon name="search" size={13} />
				<TextInput
					bind:element={filterInput}
					bind:value={query}
					bare
					class="h-8 min-w-0 flex-1 text-xs"
					ariaLabel="Filter chats and files"
					placeholder="Find a chat or file"
				/>
			</label>
			{#each filteredTabs as tab (tab.key)}
				<DropdownItem
					role="menuitem"
					selected={tab.selected}
					class="w-full"
					onSelect={() => {
						open = false;
						tab.open();
					}}
				>
					<span class="min-w-0 flex-1 truncate text-left"><SensitiveText text={tab.name} /></span>
					<span class="text-fg-tertiary max-w-28 shrink-0 truncate text-[10px]">{tab.detail}</span>
				</DropdownItem>
			{/each}
			{#if filteredTabs.length === 0}
				<p class="text-fg-tertiary px-2 py-3 text-center text-xs">No matching chats or files</p>
			{/if}
		</div>
	{/snippet}
</Dropdown>
