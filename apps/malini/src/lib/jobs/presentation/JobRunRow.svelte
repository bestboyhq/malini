<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		displayWorkstreamName,
		projectsQuery,
		workstreamByIdQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { JOB_RUN_STATUS } from './job-run-status';
	import { jobRunTime } from './job-run-time';

	interface Props {
		run: JobRunRecord;
		nowMs: number;
		onopen?: (() => void) | undefined;
	}

	let { run, nowMs, onopen }: Props = $props();

	let armed = $state(false);

	const workstream = $derived(workstreamByIdQuery.data(run.workstreamId ?? ''));
	const projects = $derived(projectsQuery.data);
	const actionState = $derived(jobActionStateQuery.data(run.id));
	const look = $derived(JOB_RUN_STATUS[run.status]);
	const placeName = $derived(
		workstream
			? displayWorkstreamName(workstream)
			: (projects.find((project) => project.id === run.repositoryId)?.name ?? null),
	);
	const subject = $derived(placeName ? `${run.title} · ${placeName}` : run.title);
	const transcriptHref = $derived(
		run.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: null,
	);
	const cancellable = $derived(run.status === 'queued' || run.status === 'running');
	const showsDetail = $derived(
		run.detail !== null && (run.status === 'needs-you' || run.status === 'failed'),
	);

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

{#snippet summary()}
	<span class={['mt-px grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
		{#if run.status === 'running'}
			<LoadingCircle size={12} />
		{:else}
			<Icon name={look.icon} size={13} />
		{/if}
	</span>
	<span class="block min-w-0 flex-1">
		<span class="flex min-w-0 items-baseline gap-1 text-xs">
			<span class="text-fg-default truncate font-medium">{run.title}</span>
			{#if placeName}
				<span class="text-fg-tertiary min-w-0 truncate">· {placeName}</span>
			{/if}
		</span>
		<span class="text-2xs mt-0.5 flex items-center gap-1 tabular-nums">
			<span class={['font-medium', look.tone]}>{look.label}</span>
			<span class="text-fg-tertiary">· {jobRunTime(run, nowMs)}</span>
		</span>
		{#if showsDetail}
			<span class="text-fg-tertiary text-2xs mt-0.5 line-clamp-2 block">{run.detail}</span>
		{/if}
	</span>
{/snippet}

<div class="flex items-start gap-1 rounded-lg" data-testid="job-run-row" data-job-run-id={run.id}>
	{#if transcriptHref}
		<Button
			bare
			href={transcriptHref}
			ariaLabel={`Open transcript: ${subject}, ${look.label}`}
			class="hover:bg-surface-elevated-hover focus-visible:ring-border-default/50 flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2"
			onclick={() => onopen?.()}
		>
			{@render summary()}
		</Button>
	{:else}
		<Button
			bare
			disabled
			ariaLabel={`${subject}, ${look.label}. The transcript opens once the job starts`}
			class="flex min-w-0 flex-1 cursor-default items-start gap-2 rounded-lg px-2 py-1.5 text-left"
		>
			{@render summary()}
		</Button>
	{/if}
	{#if cancellable}
		<div class="flex shrink-0 items-center self-center pr-1">
			{#if armed}
				<Button
					variant="danger-ghost"
					size="xs"
					ariaLabel={`Confirm cancelling ${run.title}`}
					loading={actionState.busy}
					data-armed="true"
					data-testid="job-run-cancel-confirm"
					onclick={onCancel}
				>
					Cancel job
				</Button>
			{:else}
				<Tooltip content="Cancel job" placement="top">
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel={`Cancel ${run.title}`}
						disabled={actionState.busy}
						data-testid="job-run-cancel"
						onclick={onCancel}
					>
						<Icon name="close" size={12} />
					</IconButton>
				</Tooltip>
			{/if}
		</div>
	{/if}
</div>
