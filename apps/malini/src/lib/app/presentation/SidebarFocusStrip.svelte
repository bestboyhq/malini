<script lang="ts" module>
	import type { SidebarFocus } from '$lib/app/domain/sidebar-focus';

	export type FocusChoice = Readonly<{
		focus: SidebarFocus;
		label: string;
		avatarFullName: string;
	}>;
</script>

<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		DEFAULT_SIDEBAR_ARRANGEMENT,
		SIDEBAR_GROUPINGS,
		SIDEBAR_ORDERINGS,
		SIDEBAR_SUBGROUPINGS,
		isDefaultArrangement,
		sectionedGrouping,
		type SidebarArrangement,
	} from '$lib/app/domain/sidebar-arrangement';
	import { ALL_FOCUS, focusKey, sameFocus } from '$lib/app/domain/sidebar-focus';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import ArrangeChoice from './ArrangeChoice.svelte';
	import { GROUPING_ICONS, ORDERING_ICONS, SUBGROUPING_ICONS } from './sidebar-arrangement-icons';

	interface Props {
		active: SidebarFocus;
		pinned: readonly FocusChoice[];
		owners: readonly FocusChoice[];
		repositories: readonly FocusChoice[];
		attention: (focus: SidebarFocus) => boolean;
		arrangement: SidebarArrangement;
		onchoose: (focus: SidebarFocus) => void;
		ontogglepin: (focus: SidebarFocus) => void;
		onarrange: (change: Partial<SidebarArrangement>) => void;
	}

	let {
		active,
		pinned,
		owners,
		repositories,
		attention,
		arrangement,
		onchoose,
		ontogglepin,
		onarrange,
	}: Props = $props();

	let pinMenuOpen = $state(false);
	let arrangeOpen = $state(false);
	let strip: HTMLDivElement | null = $state(null);

	const sectioned = $derived(sectionedGrouping(arrangement.grouping));
	const dragHint = $derived(
		sectioned
			? 'Group by organization or repository to drag rows.'
			: arrangement.ordering === 'manual'
				? null
				: 'Order manually to drag rows.',
	);

	function isPinned(focus: SidebarFocus): boolean {
		return pinned.some((choice) => sameFocus(choice.focus, focus));
	}
</script>

<div
	bind:this={strip}
	class="bg-surface-root mx-2 mb-1.5 flex items-center gap-0.5 rounded-[11px] p-[3px]"
	role="group"
	aria-label="Focus"
	data-testid="sidebar-focus"
>
	{@render chip(ALL_FOCUS, 'All', null)}
	{#each pinned as choice (focusKey(choice.focus))}
		{@render chip(choice.focus, choice.label, choice.avatarFullName)}
	{/each}
	<span class="grow"></span>
	<Dropdown
		bind:open={arrangeOpen}
		positionAnchor={strip}
		side="right"
		align="start"
		sideOffset={12}
		role={null}
		keyboardNavigation={false}
		panelClass="w-72"
		contentClass="p-1"
		testId="sidebar-arrange-panel"
	>
		{#snippet trigger()}
			<Tooltip content="Group and sort" placement="bottom">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Group and sort"
					ariaHasPopup="dialog"
					ariaExpanded={arrangeOpen}
					data-testid="sidebar-arrange"
				>
					<Icon name="settings" size={14} />
				</IconButton>
			</Tooltip>
		{/snippet}
		{#snippet content()}
			<div class="flex flex-col" role="group" aria-label="Group and sort">
				<ArrangeChoice
					icon="layers"
					label="Grouping"
					value={arrangement.grouping}
					choices={SIDEBAR_GROUPINGS}
					icons={GROUPING_ICONS}
					onchoose={(grouping) => onarrange({ grouping })}
				/>
				{#if sectioned}
					<ArrangeChoice
						icon="list-indent"
						label="Sub-grouping"
						value={arrangement.subgrouping}
						choices={SIDEBAR_SUBGROUPINGS}
						icons={SUBGROUPING_ICONS}
						onchoose={(subgrouping) => onarrange({ subgrouping })}
					/>
				{/if}
				<ArrangeChoice
					icon="arrow-up-down"
					label="Ordering"
					value={arrangement.ordering}
					choices={SIDEBAR_ORDERINGS}
					icons={ORDERING_ICONS}
					onchoose={(ordering) => onarrange({ ordering })}
				/>
				{#if dragHint || !isDefaultArrangement(arrangement)}
					<div
						class="border-surface-elevated-border mt-1 flex min-h-9 items-center gap-2 border-t py-1.5 pr-1 pl-2"
					>
						<p class="text-fg-tertiary text-2xs min-w-0 flex-1 leading-4">{dragHint}</p>
						{#if !isDefaultArrangement(arrangement)}
							<Button
								variant="ghost"
								size="sm"
								class="font-normal"
								onclick={() => onarrange(DEFAULT_SIDEBAR_ARRANGEMENT)}
							>
								Reset
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		{/snippet}
	</Dropdown>
	<Dropdown bind:open={pinMenuOpen} side="bottom" align="end" role={null} panelClass="w-64">
		{#snippet trigger()}
			<Tooltip content="Pin an organization or repository" placement="bottom">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Pin an organization or repository"
					ariaHasPopup="menu"
					ariaExpanded={pinMenuOpen}
					data-testid="sidebar-focus-pin"
				>
					<Icon name="plus" size={14} />
				</IconButton>
			</Tooltip>
		{/snippet}
		{#snippet content()}
			<div class="p-1.5" role="menu" aria-label="Pin to the sidebar">
				{#if owners.length > 0}
					<p class="text-fg-tertiary text-2xs px-2 pt-1 pb-1 font-medium">Organizations</p>
					{#each owners as choice (focusKey(choice.focus))}
						{@render pinItem(choice)}
					{/each}
				{/if}
				{#if repositories.length > 0}
					<p class="text-fg-tertiary text-2xs px-2 pt-2 pb-1 font-medium">Repositories</p>
					{#each repositories as choice (focusKey(choice.focus))}
						{@render pinItem(choice)}
					{/each}
				{/if}
			</div>
		{/snippet}
	</Dropdown>
</div>

{#snippet chip(focus: SidebarFocus, label: string, avatarFullName: string | null)}
	{@const pressed = sameFocus(active, focus)}
	{@const needsYou = !pressed && attention(focus)}
	<Tooltip content={focus.kind === 'all' ? 'Everything' : `Focus on ${label}`} placement="bottom">
		<Button
			bare
			ariaLabel={needsYou ? `${label}, needs you` : label}
			ariaPressed={pressed}
			class={[
				'relative inline-flex h-[26px] min-w-[30px] cursor-pointer items-center justify-center gap-1.5 rounded-lg px-[7px] text-xs font-medium outline-none',
				pressed
					? 'bg-surface-50-selected text-fg-default pr-2.5'
					: 'text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover',
			]}
			data-testid="sidebar-focus-chip"
			onclick={() => onchoose(focus)}
			oncontextmenu={(event) => {
				if (focus.kind === 'all') return;
				event.preventDefault();
				ontogglepin(focus);
			}}
		>
			{#if avatarFullName === null}
				<Icon name="globe" size={15} />
			{:else}
				<RepositoryAvatar fullName={avatarFullName} size={16} />
			{/if}
			{#if pressed}
				<span class="max-w-28 truncate">{label}</span>
			{/if}
			{#if needsYou}
				<span
					class="bg-brand-icon absolute top-[3px] right-[3px] h-1.5 w-1.5 rounded-full"
					aria-hidden="true"
					data-testid="sidebar-focus-attention"
				></span>
			{/if}
		</Button>
	</Tooltip>
{/snippet}

{#snippet pinItem(choice: FocusChoice)}
	{@const pinnedNow = isPinned(choice.focus)}
	<DropdownItem
		role="menuitemcheckbox"
		aria-checked={pinnedNow}
		class="gap-2.5"
		closeOnSelect={false}
		onSelect={() => ontogglepin(choice.focus)}
	>
		<RepositoryAvatar fullName={choice.avatarFullName} size={16} />
		<span class="min-w-0 flex-1 truncate text-left">{choice.label}</span>
		{#if pinnedNow}
			<Icon name="check" size={13} class="text-fg-secondary shrink-0" />
		{/if}
	</DropdownItem>
{/snippet}
