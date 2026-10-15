<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { instructionsPreview } from './job-definition-copy';
	import { JOB_RUN_STATUS } from './job-run-status';
	import { jobRunTime } from './job-run-time';

	interface Props {
		run: JobRunRecord;
	}

	let { run }: Props = $props();

	let armed = $state(false);
	let nowMs = $state(Date.now());

	const actionState = $derived(jobActionStateQuery.data(run.id));
	const look = $derived(JOB_RUN_STATUS[run.status]);
	const cancellable = $derived(run.status === 'queued' || run.status === 'running');
	const detail = $derived(run.detail ? instructionsPreview(run.detail) : '');
	const transcriptHref = $derived(
		run.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: null,
	);

	$effect(() => {
		const clock = setInterval(
			() => (nowMs = Date.now()),
			run.status === 'running' ? 1_000 : 30_000,
		);
		return () => clearInterval(clock);
	});

	$effect(() => {
		if (!armed) return;
		return disarmOnDismiss(() => (armed = false));
	});

	function onCancel(): void {
		if (!armed) {
			armed = true;
			return;
		}
		armed = false;
		cancelJobRunCommand(run);
	}
</script>

<article
	class="border-surface-50-border bg-surface-50 flex w-full flex-col gap-1 rounded-md border-[0.5px] px-3 py-2 text-xs"
	aria-label={`Job ${run.title}`}
	data-testid="job-run-card"
	data-job-run-id={run.id}
>
	<div class="flex h-6 items-center gap-2">
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			{#if run.status === 'running'}
				<LoadingCircle size={12} />
			{:else}
				<Icon name={look.icon} size={13} />
			{/if}
		</span>
		<p class="min-w-0 flex-1 truncate">
			<span class="text-fg-tertiary">Job</span>
			<span class="text-fg-default font-medium">{run.title}</span>
		</p>
		<p class="text-2xs shrink-0 tabular-nums">
			<span class={look.tone}>{look.label}</span>
			<span class="text-fg-tertiary">· {jobRunTime(run, nowMs)}</span>
		</p>
	</div>
	{#if run.status === 'queued'}
		<p class="text-fg-tertiary pl-6 leading-5">Starts when this workstream is idle</p>
	{/if}
	{#if detail}
		<p class="text-fg-secondary line-clamp-3 pl-6 leading-5 break-words select-text">{detail}</p>
	{/if}
	{#if transcriptHref || cancellable}
		<div class="flex items-center gap-1 pt-0.5 pl-4">
			{#if transcriptHref}
				<Button variant="ghost" size="sm" href={transcriptHref}>Open transcript</Button>
			{/if}
			{#if cancellable && armed}
				<Button
					variant="danger-ghost"
					size="sm"
					ariaLabel={`Confirm cancelling ${run.title}`}
					loading={actionState.busy}
					data-armed="true"
					onclick={onCancel}
				>
					Cancel job
				</Button>
			{:else if cancellable}
				<Button
					variant="ghost"
					size="sm"
					ariaLabel={`Cancel ${run.title}`}
					disabled={actionState.busy}
					onclick={onCancel}
				>
					Cancel
				</Button>
			{/if}
		</div>
	{/if}
</article>
