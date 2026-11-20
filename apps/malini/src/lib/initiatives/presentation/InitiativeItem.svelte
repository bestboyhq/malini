<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
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

	type Focus = 'row' | 'field';

	interface Props {
		initiative: Initiative;
		standingOf: StandingOf;
		open: boolean;
		focus: Focus | null;
		ontoggle: () => void;
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
		focus,
		ontoggle,
		onmove,
		ondragstart,
		ondragend,
		onfocused,
		onstart,
	}: Props = $props();

	const DRAG_TYPE = 'application/x-malini-initiative';

	const hintId = $props.id();

	let renaming: boolean = $state(false);

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
		onfocused();
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group/row hover:bg-surface-root-hover -mx-1.5 flex min-h-8 items-center gap-1 rounded-md px-1.5"
	draggable={!renaming}
	ondragstart={onrowdragstart}
	{ondragend}
>
	{#if renaming}
		<span class="flex min-w-0 flex-1 items-center gap-2.5 text-base font-medium">
			<ProgressRing done={progress.done} total={progress.total} />
			<TitleEditor
				title={initiative.title}
				label={`Rename ${initiative.title}`}
				onsave={(title) => updateInitiativeCommand(initiative.id, { title })}
				onclose={() => (renaming = false)}
			/>
		</span>
	{:else}
		<Button
			bare
			ariaLabel={initiative.title}
			ariaExpanded={open}
			ariaDescribedby={hintId}
			ariaKeyshortcuts="Alt+ArrowUp Alt+ArrowDown"
			class="focus-visible:ring-border-default/50 flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2"
			onclick={ontoggle}
			onkeydown={onrowkeydown}
			{@attach focus === 'row' ? grab : null}
		>
			<ProgressRing done={progress.done} total={progress.total} />
			<span class="text-fg-default min-w-0 flex-1 truncate text-base font-medium">
				<SensitiveText text={initiative.title} />
			</span>
			<span class="text-2xs text-fg-tertiary flex shrink-0 items-center gap-2.5 whitespace-nowrap">
				{#if progress.total > 0}
					<span>{progress.done} of {progress.total}</span>
				{/if}
				{#if needsYou}
					<span class="text-brand-foreground">{needsYou}</span>
				{/if}
			</span>
			<Icon
				name="chevron-right"
				size={12}
				class={[
					'text-fg-quaternary shrink-0 transition-transform duration-150 motion-reduce:transition-none',
					open && 'rotate-90',
				]}
			/>
		</Button>
		<RowMenu
			name={initiative.title}
			confirmsDelete={initiative.dependencies.length > 0}
			onrename={() => (renaming = true)}
			onremovedate={initiative.dueOn === null
				? null
				: () => updateInitiativeCommand(initiative.id, { dueOn: null })}
			ondelete={() => deleteInitiativeCommand(initiative.id)}
		/>
	{/if}
	<span id={hintId} class="sr-only">{hint}</span>
</div>
{#if open}
	<div class="pt-0.5 pb-1 pl-[26px]">
		{#each initiative.dependencies as dependency (dependency.id)}
			<DependencyItem {dependency} {standingOf} onstart={() => onstart(dependency)} />
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
