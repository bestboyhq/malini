<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { JOBS_ACTIVITY_HREF, jobHref, workstreamHref } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';
	import type { JobCenterEntry } from '$lib/jobs/domain/job-center';
	import { UNRUN_QUESTION_TITLE } from '$lib/jobs/domain/reconciler';
	import { decisionQuestion } from './automations/decision-copy';
	import { jobQuestionReason } from './job-center-summary';
	import { jobPlace } from './job-place';
	import { JOB_RUN_STATUS } from './job-run-status';

	interface Props {
		entry: JobCenterEntry;
		shownIn?: string | null;
	}

	let { entry, shownIn = null }: Props = $props();

	const run = $derived(entry.run);
	const decision = $derived(entry.question);
	const title = $derived(run?.title ?? UNRUN_QUESTION_TITLE);
	const place = $derived(jobPlace(run, entry.workstreamId));
	const placeName = $derived(
		shownIn === null ? place : entry.workstreamId !== shownIn && place ? `Job in ${place}` : 'Job',
	);
	const reason = $derived(jobQuestionReason(entry));
	const look = $derived(
		run?.status === 'failed' || run?.status === 'needs-you'
			? JOB_RUN_STATUS[run.status]
			: JOB_RUN_STATUS.waiting,
	);
	const href = $derived(
		run?.status === 'needs-you' && run.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: entry.workstreamId
				? workstreamHref(entry.workstreamId)
				: run
					? jobHref(run.definitionId)
					: JOBS_ACTIVITY_HREF,
	);
	const current = $derived.by(() => {
		const target = new URL(href, page.url);
		return (
			target.pathname === page.url.pathname &&
			[...target.searchParams].every(([key, value]) => page.url.searchParams.get(key) === value)
		);
	});
	const detail = $derived(
		decision ? decisionQuestion(decision) : run?.status === 'needs-you' ? run.detail : null,
	);
</script>

{#snippet link()}
	<Button
		bare
		{href}
		ariaLabel={`${title}${place ? ` in ${place}` : ''}: ${reason}`}
		ariaCurrent={current ? 'page' : 'false'}
		class="group hover:bg-surface-50-hover data-[active=true]:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl pr-1 pl-2 text-left text-xs outline-none focus-visible:ring-2"
		data-active={current ? 'true' : undefined}
		data-testid="job-question"
		data-job-run-id={run?.id}
		data-decision-id={decision?.id}
	>
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			<Icon name={look.icon} size={13} />
		</span>
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium">{title}</span>
			{#if placeName}
				<span class="text-fg-tertiary">· {placeName}</span>
			{/if}
		</span>
		<span class="text-brand-foreground text-2xs shrink-0">{reason}</span>
		<Icon
			name="chevron-right"
			size={12}
			class="text-fg-tertiary group-hover:text-fg-default shrink-0"
		/>
	</Button>
{/snippet}

{#if detail}
	<Tooltip content={detail} placement="left" class="w-full min-w-0">
		{@render link()}
	</Tooltip>
{:else}
	{@render link()}
{/if}
