<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { addInitiativeDependencyCommand } from '$lib/initiatives/application/commands/add-initiative-dependency.command';
	import { deleteInitiativeCommand } from '$lib/initiatives/application/commands/delete-initiative.command';
	import { updateInitiativeCommand } from '$lib/initiatives/application/commands/update-initiative.command';
	import {
		initiativeProgress,
		type Initiative,
		type InitiativeDependency,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import DependencyItem from './DependencyItem.svelte';
	import ProgressRing from './ProgressRing.svelte';
	import QuietField from './QuietField.svelte';
	import RowMenu from './RowMenu.svelte';
	import TitleEditor from './TitleEditor.svelte';
	import { caretAt } from './title-caret';

	type Focus = 'row' | 'field';

	interface Props {
		initiative: Initiative;
		standingOf: StandingOf;
		open: boolean;
		selected: string | null;
		focus: Focus | null;
		ontoggle: () => void;
		onselect: (id: string) => void;
		onmove: (days: -1 | 1) => void;
		ondragstart: () => void;
		ondragend: () => void;
		onfocused: () => void;
		onstart: (dependency: InitiativeDependency) => void;
	}

	let {
		initiative,
		standingOf,
		open,
		selected,
		focus,
		ontoggle,
		onselect,
		onmove,
		ondragstart,
		ondragend,
		onfocused,
		onstart,
	}: Props = $props();

	const DRAG_TYPE = 'application/x-malini-initiative';

	const hintId = $props.id();

	let renaming: boolean = $state(false);
	let caret: number | null = $state(null);
	let regrab: boolean = $state(false);

	const progress = $derived(initiativeProgress(initiative, standingOf));
	const needsYou = $derived(
		progress.needsYou === 0
			? null
			: `${progress.needsYou} ${progress.needsYou === 1 ? 'needs' : 'need'} you`,
	);
	const hint = $derived(
		[
			progress.total > 0 ? `${progress.done} of ${progress.total} done` : 'No dependencies yet',
			needsYou,
			'Drag to another day',
			'Option-Up or Option-Down moves it a day',
		]
			.filter(Boolean)
			.join('. '),
	);

	function grab(row: HTMLElement): void {
		row.focus();
		regrab = false;
		if (focus === 'row') onfocused();
	}

	function rename(at: number | null): void {
		caret = at;
		renaming = true;
	}

	function close(byKey: boolean): void {
		renaming = false;
		regrab = byKey;
	}

	function onrowkeydown(event: KeyboardEvent): void {
		if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		onmove(event.key === 'ArrowUp' ? -1 : 1);
	}

	function onrowdragstart(event: DragEvent): void {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData(DRAG_TYPE, initiative.id);
		ondragstart();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class={[
		'group/row -mx-1.5 flex min-h-8 items-center gap-2.5 rounded-md px-1.5',
		selected === initiative.id ? 'bg-surface-root-selected' : 'hover:bg-surface-root-hover',
	]}
	role="group"
	aria-label={initiative.title}
	draggable={!renaming}
	ondragstart={onrowdragstart}
	{ondragend}
	onclick={() => onselect(initiative.id)}
>
	<ProgressRing done={progress.done} total={progress.total} />
	{#if renaming}
		<TitleEditor
			title={initiative.title}
			label={`Rename ${initiative.title}`}
			{caret}
			class="text-base font-medium"
			onsave={(title) => updateInitiativeCommand(initiative.id, { title })}
			onclose={close}
		/>
	{:else}
		<Button
			bare
			ariaLabel={initiative.title}
			ariaDescribedby={hintId}
			ariaKeyshortcuts="Alt+ArrowUp Alt+ArrowDown"
			class="focus-visible:ring-border-default/50 text-fg-default flex min-h-8 min-w-0 cursor-text items-center rounded-md text-left text-base font-medium outline-none focus-visible:ring-2"
			onclick={(event) => rename(caretAt(event, initiative.title))}
			onkeydown={onrowkeydown}
			{@attach focus === 'row' || regrab ? grab : null}
		>
			<span class="min-w-0 truncate"><SensitiveText text={initiative.title} /></span>
		</Button>
		{#if initiative.note}
			<Icon name="note" size={12} ariaLabel="Has a note" class="text-fg-quaternary shrink-0" />
		{/if}
		<span class="min-w-0 flex-1"></span>
		<span class="text-2xs text-fg-tertiary flex shrink-0 items-center gap-2.5 whitespace-nowrap">
			{#if progress.total > 0}
				<span>{progress.done} of {progress.total}</span>
			{/if}
			{#if needsYou}
				<span class="text-brand-foreground">{needsYou}</span>
			{/if}
		</span>
		<span class="flex shrink-0 items-center">
			<Tooltip content={open ? 'Hide dependencies' : 'Show dependencies'} placement="top">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel={`Dependencies of ${initiative.title}`}
					ariaExpanded={open}
					class={[
						'text-fg-tertiary',
						open && 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100',
					]}
					onclick={(event) => {
						event.stopPropagation();
						ontoggle();
					}}
				>
					<Icon
						name="chevron-down"
						size={14}
						class={[
							'transition-transform duration-150 motion-reduce:transition-none',
							!open && '-rotate-90',
						]}
					/>
				</IconButton>
			</Tooltip>
			<RowMenu
				name={initiative.title}
				confirmsDelete={initiative.dependencies.length > 0}
				onrename={() => rename(null)}
				onremovedate={initiative.dueOn === null
					? null
					: () => updateInitiativeCommand(initiative.id, { dueOn: null })}
				ondelete={() => deleteInitiativeCommand(initiative.id)}
			/>
		</span>
	{/if}
	<span id={hintId} class="sr-only">{hint}</span>
</div>
{#if open}
	<div class="pt-0.5 pb-1 pl-[26px]">
		{#each initiative.dependencies as dependency (dependency.id)}
			<DependencyItem
				{dependency}
				{standingOf}
				selected={selected === dependency.id}
				onselect={() => onselect(dependency.id)}
				onstart={() => onstart(dependency)}
			/>
		{/each}
		<QuietField
			label={`Add a dependency to ${initiative.title}`}
			placeholder="Add a dependency"
			shown={initiative.dependencies.length === 0}
			focused={focus === 'field'}
			class="pl-6 text-sm"
			{onfocused}
			onsubmit={(title) => {
				addInitiativeDependencyCommand(initiative.id, title);
				return true;
			}}
		/>
	</div>
{/if}
