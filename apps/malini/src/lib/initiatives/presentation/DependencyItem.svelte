<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
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

	interface Props {
		dependency: InitiativeDependency;
		standingOf: StandingOf;
		onstart: () => void;
	}

	let { dependency, standingOf, onstart }: Props = $props();

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
</script>

<div>
	<div
		class="group/row hover:bg-surface-root-hover -mx-1.5 flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-sm"
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
				onsave={(title) => updateInitiativeDependencyCommand(dependency.id, { title })}
				onclose={() => (renaming = false)}
			/>
		{:else}
			<span
				class={[
					'min-w-0 flex-1 truncate',
					isFinished(status) ? 'text-fg-quaternary line-through' : 'text-fg-default',
				]}
			>
				<SensitiveText text={dependency.title} />
			</span>
			<span class="flex shrink-0 items-center gap-2">
				{#each asks as ask, index (index)}
					<Tooltip content={ask} placement="top" onlyWhenTruncated>
						<span class="text-2xs text-brand-foreground max-w-56 truncate">
							<SensitiveText text={ask} />
						</span>
					</Tooltip>
				{/each}
				{#if status === 'todo'}
					<Button
						variant="secondary"
						size="sm"
						bordered
						class="group-hover/row:bg-button-secondary-hover group-hover/row:text-fg-default"
						onclick={onstart}
					>
						Start workstream
					</Button>
				{/if}
				<RowMenu
					name={dependency.title}
					confirmsDelete={false}
					onrename={() => (renaming = true)}
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
