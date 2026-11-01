<script lang="ts">
	import type { ReconcilerCandidate } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		leadScopeLabel,
		parseLeadScope,
		projectsQuery,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { confirmJobRunCommand } from '$lib/jobs/application/commands/confirm-job-run.command';
	import { decideCommand } from '$lib/jobs/application/commands/decide.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';
	import { jobRunByIdQuery } from '$lib/jobs/application/queries/job-run-by-id.query.svelte';
	import type { JobCenterEntry } from '$lib/jobs/domain/job-center';
	import { UNRUN_QUESTION_TITLE } from '$lib/jobs/domain/reconciler';
	import { decisionChoices, decisionQuestion } from './automations/decision-copy';
	import { triggerFor, whenClause } from './automations/triggers';
	import { JOB_RUN_STATUS } from './job-run-status';
	import { activityTime, jobRunTime } from './job-run-time';

	interface Props {
		entry: JobCenterEntry;
		nowMs: number;
		shownIn?: string | null;
	}

	let { entry, nowMs, shownIn = null }: Props = $props();

	const run = $derived(entry.run);
	const decision = $derived(entry.question);
	const actionState = $derived(jobActionStateQuery.data(entry.key));
	const title = $derived(run?.title ?? UNRUN_QUESTION_TITLE);
	const workstreamName = $derived(workstreamNameQuery.data(entry.workstreamId ?? ''));
	const leadScope = $derived(parseLeadScope(run?.scope ?? null));
	const place = $derived(
		(leadScope && leadScopeLabel(leadScope)) ??
			workstreamName ??
			projectsQuery.data.find((project) => project.id === run?.repositoryId)?.name ??
			null,
	);
	const placeName = $derived(
		shownIn === null ? place : entry.workstreamId !== shownIn && place ? `Job in ${place}` : 'Job',
	);
	const parent = $derived(jobRunByIdQuery.data(run?.parentRunId ?? null));
	const trigger = $derived(
		run === null ? null : (jobDefinitionByIdQuery.data(run.definitionId)?.trigger ?? null),
	);
	const question = $derived(
		decision
			? decisionQuestion(decision)
			: run?.status === 'needs-you'
				? (run.detail ?? 'Asks you in its chat.')
				: 'Wants to run',
	);
	const hint = $derived(
		decision || run?.status !== 'waiting'
			? null
			: (run.detail ??
					(parent
						? `After ${parent.title}`
						: trigger
							? whenClause(triggerFor(trigger.when))
							: null)),
	);
	const time = $derived(
		decision
			? activityTime({ status: 'asking', startedAt: decision.createdAt, finishedAt: null }, nowMs)
			: run
				? jobRunTime(run, nowMs)
				: '',
	);
	const look = $derived(run?.status === 'failed' ? JOB_RUN_STATUS.failed : JOB_RUN_STATUS.waiting);
	const transcriptHref = $derived(
		run?.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: null,
	);
	const choices = $derived(decision ? decisionChoices(decision) : []);

	function choiceLabel(candidate: ReconcilerCandidate): string {
		switch (candidate.kind) {
			case 'run-job':
				return candidate.definitionId === run?.definitionId
					? 'Run again'
					: (jobDefinitionByIdQuery.data(candidate.definitionId)?.name ?? candidate.label);
			case 'wake-chat':
				return 'Tell its chat';
			default:
				return 'Dismiss';
		}
	}
</script>

{#snippet heading()}
	<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
		<Icon name={look.icon} size={13} />
	</span>
	<span class="min-w-0 flex-1 truncate">
		<span class="text-fg-default font-medium">{title}</span>
		{#if placeName}
			<span class="text-fg-tertiary">· {placeName}</span>
		{/if}
	</span>
{/snippet}

<div
	class="hover:bg-surface-50-hover flex flex-col rounded-xl pb-2"
	role="group"
	aria-label={`${title}${place ? ` in ${place}` : ''}: ${question}`}
	data-testid="job-question"
	data-job-run-id={run?.id}
	data-decision-id={decision?.id}
>
	{#if transcriptHref}
		<Button
			bare
			href={transcriptHref}
			ariaLabel={`Open transcript: ${title}`}
			class="focus-visible:ring-border-default/50 flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-xs outline-none focus-visible:ring-2"
		>
			{@render heading()}
		</Button>
	{:else}
		<div class="flex h-7 min-w-0 items-center gap-2 px-2 text-xs">
			{@render heading()}
		</div>
	{/if}
	<p class="text-fg-secondary pr-2 pl-8 text-xs">
		<SensitiveText text={question} />
		{#if hint}
			<span class="text-fg-tertiary">· {hint}</span>
		{/if}
		<span class="text-fg-tertiary whitespace-nowrap tabular-nums">· {time}</span>
	</p>
	{#if actionState.error}
		<p class="text-error-content pr-2 pl-8 text-xs" role="alert">{actionState.error}</p>
	{/if}
	<div class="mt-1.5 flex flex-wrap items-center gap-1.5 pr-2 pl-8">
		{#if decision}
			{#each choices as { index, candidate }, order (index)}
				{#snippet choice()}
					<Button
						variant={candidate.kind === 'nothing' ? 'ghost' : order === 0 ? 'primary' : 'secondary'}
						size="sm"
						ariaLabel={candidate.kind === 'nothing' ? `Dismiss: ${title}` : candidate.label}
						disabled={actionState.busy}
						onclick={() => decideCommand(decision, index)}
					>
						{choiceLabel(candidate)}
					</Button>
				{/snippet}
				{#if candidate.kind === 'wake-chat'}
					<Tooltip content={candidate.label} placement="top">
						{@render choice()}
					</Tooltip>
				{:else}
					{@render choice()}
				{/if}
			{/each}
		{:else if run?.status === 'waiting'}
			<Button
				variant="primary"
				size="sm"
				ariaLabel={`Run it: ${title}`}
				loading={actionState.busy}
				onclick={() => confirmJobRunCommand(run)}
			>
				Run it
			</Button>
			<Button
				variant="ghost"
				size="sm"
				ariaLabel={`Skip ${title}`}
				disabled={actionState.busy}
				onclick={() => cancelJobRunCommand(run)}
			>
				Skip
			</Button>
		{:else if transcriptHref}
			<Button variant="secondary" size="sm" href={transcriptHref}>Open chat</Button>
		{/if}
	</div>
</div>
