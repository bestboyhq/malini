<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { catalogModelLabel, modelCatalogQuery } from '$shared/providers/providers.api';
	import { deleteJobDefinitionCommand } from '$lib/jobs/application/commands/delete-job-definition.command';
	import { resetJobDefinitionCommand } from '$lib/jobs/application/commands/reset-job-definition.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { effortLabel, instructionsPreview, jobShapeSummary } from './job-definition-copy';
	import JobRunTarget from './JobRunTarget.svelte';

	interface Props {
		definition: JobDefinitionRecord;
		editing: boolean;
		onedit: (definitionId: string) => void;
	}

	let { definition, editing, onedit }: Props = $props();

	let confirming = $state<'delete' | 'reset' | null>(null);
	let choosingTarget = $state(false);

	const catalog = $derived(modelCatalogQuery.data);
	const actionState = $derived(jobActionStateQuery.data(definition.id));
	const builtin = $derived(definition.builtin !== null);

	function onConfirm(): void {
		if (confirming === 'delete') deleteJobDefinitionCommand(definition.id);
		if (confirming === 'reset') resetJobDefinitionCommand(definition.id);
		confirming = null;
	}
</script>

<li
	class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
	data-testid="job-definition-row"
	data-job-definition-id={definition.id}
>
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				<span class="text-fg-default truncate text-sm font-medium">{definition.name}</span>
				{#if builtin}
					<Badge>Built-in</Badge>
				{/if}
				{#if editing}
					<Badge variant="primary">Editing</Badge>
				{/if}
			</div>
			<p class="text-fg-tertiary mt-0.5 truncate text-xs">
				{catalogModelLabel(catalog, definition.model)} · {effortLabel(definition.effort)} effort ·
				{jobShapeSummary(definition)}
			</p>
			<p class="text-fg-secondary mt-1.5 line-clamp-2 text-xs">
				{instructionsPreview(definition.instructions)}
			</p>
			{#if actionState.error}
				<p class="text-error-content mt-1.5 text-xs" role="alert">{actionState.error}</p>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if confirming}
				<span class="text-fg-secondary text-xs">
					{confirming === 'delete' ? 'Delete this job?' : 'Undo your edits?'}
				</span>
				<Button
					variant={confirming === 'delete' ? 'danger' : 'secondary'}
					size="2xs"
					ariaLabel={confirming === 'delete'
						? `Confirm deleting ${definition.name}`
						: `Confirm resetting ${definition.name}`}
					onclick={onConfirm}
				>
					{confirming === 'delete' ? 'Delete' : 'Reset'}
				</Button>
				<Button variant="ghost" size="2xs" onclick={() => (confirming = null)}>Keep</Button>
			{:else}
				{#if !builtin}
					<Button
						variant="secondary"
						size="2xs"
						ariaLabel={`Run ${definition.name}`}
						ariaExpanded={choosingTarget}
						loading={actionState.busy}
						onclick={() => (choosingTarget = !choosingTarget)}
					>
						Run
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="2xs"
					ariaLabel={`Edit ${definition.name}`}
					disabled={actionState.busy}
					onclick={() => onedit(definition.id)}
				>
					Edit
				</Button>
				{#if builtin}
					<Button
						variant="ghost"
						size="2xs"
						ariaLabel={`Reset ${definition.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'reset')}
					>
						Reset
					</Button>
				{:else}
					<Button
						variant="danger-ghost"
						size="2xs"
						ariaLabel={`Delete ${definition.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'delete')}
					>
						Delete
					</Button>
				{/if}
			{/if}
		</div>
	</div>
	{#if choosingTarget && !builtin}
		<JobRunTarget {definition} onclose={() => (choosingTarget = false)} />
	{/if}
</li>
