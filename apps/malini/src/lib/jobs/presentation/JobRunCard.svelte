<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { instructionsPreview } from './job-definition-copy';
	import { JOB_RUN_STATUS } from './job-run-status';
	import { jobRunTime } from './job-run-time';

	interface Props {
		run: JobRunRecord;
		nowMs: number;
	}

	let { run, nowMs }: Props = $props();

	const look = $derived(JOB_RUN_STATUS[run.status]);
	const detail = $derived(run.detail ? instructionsPreview(run.detail) : '');
	const transcriptHref = $derived(
		run.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: null,
	);
</script>

<article
	class="border-surface-50-border bg-surface-50 flex w-full flex-col gap-1 rounded-md border-[0.5px] px-3 py-2 text-xs"
	aria-label={`Job ${run.title}`}
	data-testid="job-run-card"
	data-job-run-id={run.id}
>
	<div class="flex h-6 items-center gap-2">
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			<Icon name={look.icon} size={13} />
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
	{#if detail}
		<p class="text-fg-secondary line-clamp-3 pl-6 leading-5 break-words select-text">{detail}</p>
	{/if}
	{#if transcriptHref}
		<div class="flex items-center gap-1 pt-0.5 pl-4">
			<Button variant="ghost" size="sm" href={transcriptHref}>Open transcript</Button>
		</div>
	{/if}
</article>
