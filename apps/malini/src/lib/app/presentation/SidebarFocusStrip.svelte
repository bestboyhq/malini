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
		customArrangement,
		presetArrangement,
		sidebarPreset,
		type SidebarPreset,
	} from '$lib/app/domain/sidebar-preset';
	import {
		SIDEBAR_GROUPINGS,
		SIDEBAR_ORDERINGS,
		SIDEBAR_SUBGROUPINGS,
		sectionedGrouping,
		type SidebarArrangement,
	} from '$lib/app/domain/sidebar-arrangement';
	import type { SidebarDensity } from '$lib/app/domain/sidebar-density';
	import { ALL_FOCUS, focusKey, sameFocus } from '$lib/app/domain/sidebar-focus';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import ArrangeChoice from './ArrangeChoice.svelte';
	import ChoiceSwitch from './settings/ChoiceSwitch.svelte';
	import { GROUPING_ICONS, ORDERING_ICONS, SUBGROUPING_ICONS } from './sidebar-arrangement-icons';
	import {
		DENSITY_CHOICES,
		DENSITY_LABELS,
		SHOW_CHOICES,
		SHOW_LABELS,
		REPOSITORIES_CHOICES,
		REPOSITORIES_LABELS,
	} from './sidebar-preset-copy';

	interface Props {
		active: SidebarFocus;
		pinned: readonly FocusChoice[];
		owners: readonly FocusChoice[];
		repositories: readonly FocusChoice[];
		attention: (focus: SidebarFocus) => boolean;
		arrangement: SidebarArrangement;
		density: SidebarDensity;
		onchoose: (focus: SidebarFocus) => void;
		ontogglepin: (focus: SidebarFocus) => void;
		onarrange: (change: Partial<SidebarArrangement>) => void;
		onpreset: (change: Partial<SidebarPreset>) => void;
		ondensity: (density: SidebarDensity) => void;
	}

	let {
		active,
		pinned,
		owners,
		repositories,
		attention,
		arrangement,
		density,
		onchoose,
		ontogglepin,
		onarrange,
		onpreset,
		ondensity,
	}: Props = $props();

	const advancedId = $props.id();

	let pinMenuOpen = $state(false);
	let arrangeOpen = $state(false);
	let advancedOpen = $state(false);
	let strip: HTMLDivElement | null = $state(null);

	const preset = $derived(sidebarPreset(arrangement));
	const custom = $derived(customArrangement(arrangement));
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
	class="bg-surface-50 mx-2 mb-1.5 flex items-center gap-0.5 rounded-[11px] p-[3px]"
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
		onOpenChange={(open) => {
			if (open) advancedOpen = false;
		}}
	>
		{#snippet trigger()}
			<Tooltip content="Sidebar options" placement="bottom">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Sidebar options"
					ariaHasPopup="dialog"
					ariaExpanded={arrangeOpen}
					data-testid="sidebar-arrange"
				>
					<Icon name="settings" size={14} />
				</IconButton>
			</Tooltip>
		{/snippet}
		{#snippet content()}
			<div class="flex flex-col" role="group" aria-label="Sidebar options">
				<div class="flex flex-col gap-1.5 px-1.5 pt-1.5 pb-2">
					<p class="text-fg-tertiary text-2xs pl-0.5" aria-hidden="true">Repositories</p>
					<ChoiceSwitch
						fill
						label="Repositories"
						choices={REPOSITORIES_CHOICES}
						labels={REPOSITORIES_LABELS}
						selected={preset.repositories}
						onchoose={(repositories) => onpreset({ repositories })}
					/>
				</div>
				<div class="flex flex-col gap-1.5 px-1.5 pt-0.5 pb-2">
					<p class="text-fg-tertiary text-2xs pl-0.5" aria-hidden="true">Show</p>
					<ChoiceSwitch
						fill
						label="Show"
						choices={SHOW_CHOICES}
						labels={SHOW_LABELS}
						selected={preset.show}
						onchoose={(show) => onpreset({ show })}
					/>
				</div>
				<div class="flex flex-col gap-1.5 px-1.5 pt-0.5 pb-2">
					<p class="text-fg-tertiary text-2xs pl-0.5" aria-hidden="true">Row height</p>
					<ChoiceSwitch
						fill
						label="Row height"
						choices={DENSITY_CHOICES}
						labels={DENSITY_LABELS}
						selected={density}
						onchoose={ondensity}
					/>
				</div>
				<div class="border-surface-elevated-border my-0.5 border-t"></div>
				<Button
					bare
					ariaLabel={custom ? 'Advanced, custom' : 'Advanced'}
					ariaExpanded={advancedOpen}
					ariaControls={advancedId}
					class="text-fg-secondary hover:bg-surface-elevated-hover hover:text-fg-default focus-visible:bg-surface-elevated-hover focus-visible:text-fg-default flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-xs outline-none"
					onclick={() => (advancedOpen = !advancedOpen)}
				>
					<Icon name="settings" size={14} class="text-fg-tertiary shrink-0" />
					<span class="min-w-0 flex-1 text-left">Advanced</span>
					{#if custom}
						<span
							class="bg-brand/10 text-brand-foreground text-3xs shrink-0 rounded-full px-1.5 py-px"
						>
							Custom
						</span>
					{/if}
					<Icon
						name="chevron-down"
						size={13}
						class={[
							'text-fg-tertiary shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
							advancedOpen && 'rotate-180',
						]}
					/>
				</Button>
				<div
					id={advancedId}
					class={[
						'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
						advancedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
					]}
				>
					<div
						class={[
							'flex min-h-0 flex-col overflow-hidden transition-[visibility] duration-200 motion-reduce:transition-none',
							!advancedOpen && 'invisible',
						]}
					>
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
						{#if dragHint || custom}
							<div
								class="border-surface-elevated-border mt-1 flex min-h-9 items-center gap-2 border-t py-1.5 pr-1 pl-2"
							>
								<p class="text-fg-tertiary text-2xs min-w-0 flex-1 leading-4">{dragHint}</p>
								{#if custom}
									<Button
										variant="ghost"
										size="sm"
										class="font-normal"
										onclick={() => onarrange(presetArrangement(preset))}
									>
										Reset
									</Button>
								{/if}
							</div>
						{/if}
					</div>
				</div>
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
