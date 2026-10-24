<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import {
		leadScopeLabel,
		parseLeadScope,
		projectsQuery,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { confirmJobRunCommand } from '$lib/jobs/application/commands/confirm-job-run.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';
	import { jobRunByIdQuery } from '$lib/jobs/application/queries/job-run-by-id.query.svelte';
	import { jobRunTime } from '../job-run-time';
	import { triggerFor, whenClause } from './triggers';

	interface Props {
		run: JobRunRecord;
		nowMs: number;
	}

	let { run, nowMs }: Props = $props();

	const actionState = $derived(jobActionStateQuery.data(run.id));
	const workstreamName = $derived(workstreamNameQuery.data(run.workstreamId ?? ''));
	const leadScope = $derived(parseLeadScope(run.scope));
	const place = $derived(
		(leadScope && leadScopeLabel(leadScope)) ??
			workstreamName ??
			projectsQuery.data.find((project) => project.id === run.repositoryId)?.name ??
			null,
	);
	const parent = $derived(jobRunByIdQuery.data(run.parentRunId));
	const trigger = $derived(jobDefinitionByIdQuery.data(run.definitionId)?.trigger ?? null);
	const reason = $derived(
		parent ? `After ${parent.title}` : trigger ? whenClause(triggerFor(trigger.when)) : null,
	);
</script>

<div
	class="flex items-center gap-3 px-4 py-3"
	role="group"
	aria-label={`${run.title} wants to run`}
	data-testid="job-waiting-run"
	data-job-run-id={run.id}
>
	<span
		class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-md"
		aria-hidden="true"
	>
		<Icon name="question" size={14} />
	</span>
	<div class="min-w-0 flex-1">
		<h3 class="text-fg-default truncate text-sm font-medium">{run.title} wants to run</h3>
		<p class="text-fg-tertiary truncate text-xs tabular-nums">
			{#if reason}{reason} ·{/if}
			{#if place}{leadScope?.kind === 'home' ? 'At' : 'In'} {place} ·{/if}
			{jobRunTime(run, nowMs)}
		</p>
		{#if actionState.error}
			<p class="text-error-content text-xs" role="alert">{actionState.error}</p>
		{/if}
	</div>
	<Button
		variant="ghost"
		size="sm"
		ariaLabel={`Skip ${run.title}`}
		disabled={actionState.busy}
		onclick={() => cancelJobRunCommand(run)}
	>
		Skip
	</Button>
	<Button
		variant="primary"
		size="sm"
		ariaLabel={`Run it: ${run.title}`}
		loading={actionState.busy}
		onclick={() => confirmJobRunCommand(run)}
	>
		Run it
	</Button>
</div>
