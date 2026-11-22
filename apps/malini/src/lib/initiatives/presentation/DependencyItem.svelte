<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { deleteInitiativeDependencyCommand } from '$lib/initiatives/application/commands/delete-initiative-dependency.command';
	import { updateInitiativeDependencyCommand } from '$lib/initiatives/application/commands/update-initiative-dependency.command';
	import {
		dependencyState,
		isFinished,
		type DependencyState,
		type InitiativeDependency,
		type StandingOf,
		type WorkstreamStanding,
	} from '$lib/initiatives/domain/initiative';
	import RowMenu from './RowMenu.svelte';
	import StatusIcon from './StatusIcon.svelte';
	import TitleEditor from './TitleEditor.svelte';
	import WorkstreamLine from './WorkstreamLine.svelte';
	import { caretAt } from './title-caret';

	interface Props {
		dependency: InitiativeDependency;
		standingOf: StandingOf;
		selected: boolean;
		onselect: () => void;
		onstart: () => void;
	}

	let { dependency, standingOf, selected, onselect, onstart }: Props = $props();

	type Line = Readonly<{
		workstreamId: string;
		standing: WorkstreamStanding;
		needs: string | null;
	}>;

	const STATE_LABEL: Readonly<Record<DependencyState, string>> = {
		todo: 'Not done',
		done: 'Done',
		merged: 'Merged',
		needs: 'Needs you',
		failed: 'Failed',
		running: 'Working',
		idle: 'Idle',
	};

	let renaming: boolean = $state(false);
	let caret: number | null = $state(null);
	let regrab: boolean = $state(false);

	const status = $derived(dependencyState(dependency, standingOf));
	const lines = $derived(
		dependency.workstreams.flatMap(({ workstreamId, needs }): Line[] => {
			const standing = standingOf(workstreamId);
			return standing ? [{ workstreamId, standing, needs }] : [];
		}),
	);
	const asks = $derived(
		lines.flatMap(({ standing, needs }) => (standing.dot === 'needs' && needs ? [needs] : [])),
	);
	const ticked = $derived(status === 'done');

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

<div>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div
		class={[
			'group/row -mx-1.5 flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-sm',
			selected ? 'bg-surface-root-selected' : 'hover:bg-surface-root-hover',
		]}
		role="group"
		aria-label={dependency.title}
		onclick={onselect}
	>
		{#if status === 'todo' || status === 'done'}
			<Tooltip content={ticked ? 'Done. Click to undo' : 'Mark done'} placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					role="checkbox"
					ariaChecked={ticked}
					ariaLabel={dependency.title}
					class="-m-[3px]"
					onclick={() => updateInitiativeDependencyCommand(dependency.id, { done: !ticked })}
				>
					<StatusIcon {status} size={14} />
				</IconButton>
			</Tooltip>
		{:else}
			<StatusIcon {status} size={14} label={STATE_LABEL[status]} />
		{/if}
		{#if renaming}
			<TitleEditor
				title={dependency.title}
				label={`Rename ${dependency.title}`}
				{caret}
				onsave={(title) => updateInitiativeDependencyCommand(dependency.id, { title })}
				onclose={close}
			/>
		{:else}
			<Button
				bare
				ariaLabel={`Rename ${dependency.title}`}
				class={[
					'focus-visible:ring-border-default/50 flex min-h-8 min-w-0 cursor-text items-center rounded-md text-left outline-none focus-visible:ring-2',
					isFinished(status) ? 'text-fg-quaternary line-through' : 'text-fg-default',
				]}
				onclick={(event) => rename(caretAt(event, dependency.title))}
				{@attach regrab ? grab : null}
			>
				<span class="min-w-0 truncate"><SensitiveText text={dependency.title} /></span>
			</Button>
			{#if dependency.note}
				<Icon name="note" size={12} ariaLabel="Has a note" class="text-fg-quaternary shrink-0" />
			{/if}
			<span class="min-w-0 flex-1"></span>
			<span class="flex shrink-0 items-center">
				{#each asks as ask, index (index)}
					<Tooltip content={ask} placement="top" onlyWhenTruncated>
						<span class="text-2xs text-brand-foreground mr-2 max-w-56 truncate">
							<SensitiveText text={ask} />
						</span>
					</Tooltip>
				{/each}
				{#if dependency.assignee}
					{#key dependency.assignee}
						<GitHubUserAvatar
							login={dependency.assignee}
							label={`Assigned to ${dependency.assignee}`}
							class="mr-1.5"
						/>
					{/key}
				{/if}
				{#if status === 'todo'}
					<Tooltip content="Start workstream" placement="top">
						<IconButton
							variant="ghost"
							size="sm"
							ariaLabel="Start workstream"
							class="text-fg-tertiary opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
							onclick={onstart}
						>
							<Icon name="send" size={14} />
						</IconButton>
					</Tooltip>
				{/if}
				<RowMenu
					name={dependency.title}
					confirmsDelete={false}
					onrename={() => rename(null)}
					onremovedate={null}
					ondelete={() => deleteInitiativeDependencyCommand(dependency.id)}
				/>
			</span>
		{/if}
	</div>
	{#each lines as line (line.workstreamId)}
		<WorkstreamLine workstreamId={line.workstreamId} standing={line.standing} />
	{/each}
</div>
