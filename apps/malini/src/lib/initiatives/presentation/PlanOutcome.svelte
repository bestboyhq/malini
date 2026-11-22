<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { addInitiativeDependencyCommand } from '$lib/initiatives/application/commands/add-initiative-dependency.command';
	import { updateInitiativeCommand } from '$lib/initiatives/application/commands/update-initiative.command';
	import {
		initiativeProgress,
		type Initiative,
		type InitiativeDependency,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import { dueLabel, servesWorkstream } from '$lib/initiatives/domain/plan';
	import PlanDependency from './PlanDependency.svelte';
	import ProgressRing from './ProgressRing.svelte';
	import QuietField from './QuietField.svelte';
	import TitleEditor from './TitleEditor.svelte';
	import { caretAt } from './title-caret';

	interface Props {
		initiative: Initiative;
		standingOf: StandingOf;
		today: string;
		currentWorkstreamId: string | null;
		open: boolean;
		adding: boolean;
		ontoggle: () => void;
		onadding: (adding: boolean) => void;
		onstart: (dependency: InitiativeDependency) => void;
	}

	let {
		initiative,
		standingOf,
		today,
		currentWorkstreamId,
		open,
		adding,
		ontoggle,
		onadding,
		onstart,
	}: Props = $props();

	let renaming: boolean = $state(false);
	let caret: number | null = $state(null);
	let regrab: boolean = $state(false);

	const progress = $derived(initiativeProgress(initiative, standingOf));
	const finished = $derived(progress.total > 0 && progress.done === progress.total);
	const due = $derived(dueLabel(initiative.dueOn, today, finished));
	const hint = $derived(
		progress.total > 0 ? `${progress.done} of ${progress.total} done` : 'No dependencies yet',
	);

	function grab(title: HTMLElement): void {
		title.focus();
		regrab = false;
	}

	function rename(at: number | null): void {
		caret = at;
		renaming = true;
	}

	function close(byKey: boolean): void {
		renaming = false;
		regrab = byKey;
	}
</script>

<div
	class="group/outcome hover:bg-surface-50 relative flex h-7 items-center gap-2 rounded-md px-2 text-xs"
	role="group"
	aria-label={initiative.title}
>
	<Tooltip content={hint} placement="top" class="flex shrink-0">
		<ProgressRing done={progress.done} total={progress.total} size={14} />
	</Tooltip>
	{#if renaming}
		<TitleEditor
			title={initiative.title}
			label={`Rename ${initiative.title}`}
			{caret}
			class="font-medium"
			inputClass="h-[22px]"
			onsave={(title) => updateInitiativeCommand(initiative.id, { title })}
			onclose={close}
		/>
	{:else}
		<Button
			bare
			ariaLabel={`Rename ${initiative.title}`}
			class="focus-visible:ring-border-default/50 text-fg-default flex min-w-0 cursor-text items-center rounded-sm text-left font-medium outline-none focus-visible:ring-2"
			onclick={(event) => rename(caretAt(event, initiative.title))}
			{@attach regrab ? grab : null}
		>
			<span class="min-w-0 truncate"><SensitiveText text={initiative.title} /></span>
		</Button>
		<span class="min-w-0 flex-1"></span>
		<span class="grid shrink-0 items-center justify-items-end">
			<span
				class={[
					'text-3xs col-start-1 row-start-1 whitespace-nowrap transition-opacity duration-100 group-focus-within/outcome:opacity-0 group-hover/outcome:opacity-0 motion-reduce:transition-none',
					due.late ? 'text-error-content' : 'text-fg-tertiary',
				]}
			>
				{due.text}
			</span>
			<span
				class="col-start-1 row-start-1 flex items-center opacity-0 transition-opacity duration-100 group-focus-within/outcome:opacity-100 group-hover/outcome:opacity-100 motion-reduce:transition-none"
			>
				<Tooltip content="Add a dependency" placement="top">
					<IconButton
						variant="ghost"
						size="xs"
						ariaLabel={`Add a dependency to ${initiative.title}`}
						class="text-fg-tertiary"
						onclick={() => {
							if (!open) ontoggle();
							onadding(true);
						}}
					>
						<Icon name="plus" size={12} />
					</IconButton>
				</Tooltip>
				<Tooltip content={open ? 'Hide dependencies' : 'Show dependencies'} placement="top">
					<IconButton
						variant="ghost"
						size="xs"
						ariaLabel={`Dependencies of ${initiative.title}`}
						ariaExpanded={open}
						class="text-fg-tertiary"
						onclick={ontoggle}
					>
						<Icon
							name="chevron-down"
							size={12}
							class={[
								'transition-transform duration-150 motion-reduce:transition-none',
								!open && '-rotate-90',
							]}
						/>
					</IconButton>
				</Tooltip>
			</span>
		</span>
	{/if}
</div>
{#if open}
	{#each initiative.dependencies as dependency (dependency.id)}
		<PlanDependency
			{dependency}
			{standingOf}
			here={servesWorkstream(dependency, currentWorkstreamId)}
			onstart={() => onstart(dependency)}
		/>
	{/each}
	{#if adding}
		<div class="flex h-[26px] items-center pl-[30px]">
			<QuietField
				label={`Add a dependency to ${initiative.title}`}
				placeholder="Add a dependency"
				shown
				focused
				class="text-2xs min-w-0 flex-1"
				inputClass="h-[26px]"
				onblur={(text) => {
					if (text.trim() === '') onadding(false);
				}}
				onsubmit={(title) => {
					addInitiativeDependencyCommand(initiative.id, title);
					return true;
				}}
			/>
		</div>
	{/if}
{/if}
