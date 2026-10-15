<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { deleteJobDefinitionCommand } from '$lib/jobs/application/commands/delete-job-definition.command';
	import { resetJobDefinitionCommand } from '$lib/jobs/application/commands/reset-job-definition.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobFormSubmissionQuery } from '$lib/jobs/application/queries/job-form-submission.query.svelte';
	import { isRunnableJob } from '$lib/jobs/domain/builtin-jobs';
	import { jobWhenDetail } from './job-definition-copy';
	import JobEditor from './JobEditor.svelte';
	import JobRecentRuns from './JobRecentRuns.svelte';
	import JobRunTarget from './JobRunTarget.svelte';

	interface Props {
		definition: JobDefinitionRecord;
	}

	let { definition }: Props = $props();

	let confirming = $state<'delete' | 'reset' | null>(null);
	let choosingTarget = $state(false);

	const actionState = $derived(jobActionStateQuery.data(definition.id));
	const saves = $derived(jobFormSubmissionQuery.data.saves);
	const builtin = $derived(definition.builtin !== null);
	const runnable = $derived(isRunnableJob(definition));
	const editorKey = $derived(`${definition.id}:${definition.updatedAt}:${saves}`);

	function onConfirm(): void {
		if (confirming === 'delete') deleteJobDefinitionCommand(definition.id);
		if (confirming === 'reset') resetJobDefinitionCommand(definition.id);
		confirming = null;
	}
</script>

<article
	class="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-8 pt-1 pb-16"
	aria-labelledby="job-detail-heading"
	data-testid="job-detail"
	data-job-definition-id={definition.id}
>
	<header class="flex flex-col gap-3">
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<div class="flex min-w-0 items-center gap-2">
					<h2
						id="job-detail-heading"
						class="text-fg-default truncate text-lg font-semibold tracking-tight"
					>
						{definition.name}
					</h2>
					{#if builtin}
						<Badge>Built-in</Badge>
					{/if}
				</div>
				<p class="text-fg-tertiary mt-1 text-xs leading-5">{jobWhenDetail(definition)}</p>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{#if confirming}
					<span class="text-fg-secondary text-xs">
						{confirming === 'delete' ? 'Delete this job?' : 'Undo your edits?'}
					</span>
					<Button
						variant={confirming === 'delete' ? 'danger' : 'secondary'}
						size="sm"
						ariaLabel={confirming === 'delete'
							? `Confirm deleting ${definition.name}`
							: `Confirm resetting ${definition.name}`}
						onclick={onConfirm}
					>
						{confirming === 'delete' ? 'Delete' : 'Reset'}
					</Button>
					<Button variant="ghost" size="sm" onclick={() => (confirming = null)}>Keep</Button>
				{:else}
					{#if builtin}
						<Button
							variant="ghost"
							size="sm"
							ariaLabel={`Reset ${definition.name}`}
							disabled={actionState.busy}
							onclick={() => (confirming = 'reset')}
						>
							Reset
						</Button>
					{:else}
						<Button
							variant="danger-ghost"
							size="sm"
							ariaLabel={`Delete ${definition.name}`}
							disabled={actionState.busy}
							onclick={() => (confirming = 'delete')}
						>
							Delete
						</Button>
					{/if}
					{#if runnable}
						<Button
							variant="primary"
							size="sm"
							ariaLabel={`Run ${definition.name}`}
							ariaExpanded={choosingTarget}
							loading={actionState.busy}
							onclick={() => (choosingTarget = !choosingTarget)}
						>
							Run
						</Button>
					{/if}
				{/if}
			</div>
		</div>
		{#if actionState.error}
			<p class="text-error-content text-xs" role="alert">{actionState.error}</p>
		{/if}
		{#if choosingTarget && runnable}
			<JobRunTarget {definition} onclose={() => (choosingTarget = false)} />
		{/if}
	</header>

	{#key editorKey}
		<JobEditor {definition} />
	{/key}

	{#if runnable}
		<JobRecentRuns definitionId={definition.id} />
	{/if}
</article>
