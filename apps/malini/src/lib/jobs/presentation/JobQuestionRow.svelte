<script lang="ts">
	import type { ReconcilerCandidate } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { confirmJobRunCommand } from '$lib/jobs/application/commands/confirm-job-run.command';
	import { decideCommand } from '$lib/jobs/application/commands/decide.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';
	import { jobRunByIdQuery } from '$lib/jobs/application/queries/job-run-by-id.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import type { JobCenterEntry } from '$lib/jobs/domain/job-center';
	import { isFinishedJobRunStatus } from '$lib/jobs/domain/job-run';
	import { UNRUN_QUESTION_TITLE } from '$lib/jobs/domain/reconciler';
	import { decisionChoices, decisionQuestion } from './automations/decision-copy';
	import { triggerFor, whenClause } from './automations/triggers';
	import { jobPlace } from './job-place';
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
	const waiting = $derived(decision === null && run?.status === 'waiting' ? run : null);
	const actionState = $derived(jobActionStateQuery.data(entry.key));
	const title = $derived(run?.title ?? UNRUN_QUESTION_TITLE);
	const place = $derived(jobPlace(run, entry.workstreamId));
	const placeName = $derived(
		shownIn === null ? place : entry.workstreamId !== shownIn && place ? `Job in ${place}` : 'Job',
	);
	const definition = $derived(run === null ? null : jobDefinitionByIdQuery.data(run.definitionId));
	const parent = $derived(jobRunByIdQuery.data(waiting?.parentRunId ?? null));
	const question = $derived(decision ? decisionQuestion(decision) : 'Wants to run');
	const when = $derived(
		waiting?.detail ??
			(parent
				? `After ${parent.title}`
				: definition?.trigger
					? whenClause(triggerFor(definition.trigger.when))
					: null),
	);
	const does = $derived(
		definition?.instructions
			.split('\n')
			.map((line) => line.replace(/^#+\s*/u, '').trim())
			.find((line) => line !== '') ?? null,
	);
	const lastRun = $derived(
		waiting === null
			? null
			: (jobRunsForDefinitionQuery
					.data(waiting.definitionId)
					.find((other) => other.id !== waiting.id && isFinishedJobRunStatus(other.status)) ??
					null),
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

{#snippet fact(term: string, value: string)}
	<dt class="text-fg-tertiary">{term}</dt>
	<dd class="text-fg-secondary line-clamp-2 min-w-0"><SensitiveText text={value} /></dd>
{/snippet}

<div
	class="bg-surface-100 flex flex-col gap-1 rounded-xl pt-0.5 pb-2"
	role="group"
	aria-label={`${title}${place ? ` in ${place}` : ''}: ${question}`}
	data-testid="job-question"
	data-job-run-id={run?.id}
	data-decision-id={decision?.id}
>
	<div class="flex h-7 min-w-0 items-center gap-2 pr-2 text-xs">
		{#if transcriptHref}
			<Button
				bare
				href={transcriptHref}
				ariaLabel={`Open transcript: ${title}`}
				class="focus-visible:ring-border-default/50 flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl pl-2 text-left outline-none focus-visible:ring-2"
			>
				{@render heading()}
			</Button>
		{:else}
			<div class="flex min-w-0 flex-1 items-center gap-2 pl-2">
				{@render heading()}
			</div>
		{/if}
		<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums">{time}</span>
	</div>
	{#if waiting}
		<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pr-2 pl-8 text-xs">
			{#if when}
				{@render fact('When', when)}
			{/if}
			{#if does}
				{@render fact('Does', does)}
			{/if}
			{#if lastRun}
				{@render fact(
					'Last run',
					`${jobRunTime(lastRun, nowMs)}: ${lastRun.detail ?? JOB_RUN_STATUS[lastRun.status].label}`,
				)}
			{/if}
		</dl>
	{:else}
		<p class="text-fg-secondary pr-2 pl-8 text-xs"><SensitiveText text={question} /></p>
	{/if}
	{#if actionState.error}
		<p class="text-error-content pr-2 pl-8 text-xs" role="alert">{actionState.error}</p>
	{/if}
	<div class="mt-1 flex flex-wrap items-center gap-1.5 pr-2 pl-8">
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
		{:else if waiting}
			<Button
				variant="primary"
				size="sm"
				ariaLabel={`Run it: ${title}`}
				loading={actionState.busy}
				onclick={() => confirmJobRunCommand(waiting)}
			>
				Run it
			</Button>
			<Button
				variant="ghost"
				size="sm"
				ariaLabel={`Skip ${title}`}
				disabled={actionState.busy}
				onclick={() => cancelJobRunCommand(waiting)}
			>
				Skip
			</Button>
		{/if}
	</div>
</div>
