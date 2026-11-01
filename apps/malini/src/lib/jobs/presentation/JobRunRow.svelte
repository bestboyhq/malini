<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { cancelJobRunCommand } from '$lib/jobs/application/commands/cancel-job-run.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobRunByIdQuery } from '$lib/jobs/application/queries/job-run-by-id.query.svelte';
	import ActivityKind from './automations/ActivityKind.svelte';
	import { jobPlace } from './job-place';
	import { JOB_RUN_STATUS } from './job-run-status';
	import { jobRunTime } from './job-run-time';

	interface Props {
		run: JobRunRecord;
		nowMs: number;
		placeFirst?: boolean;
		shownIn?: string | null;
		kind?: string;
		origin?: string | null;
		trailing?: Snippet | undefined;
	}

	let {
		run,
		nowMs,
		placeFirst = false,
		shownIn = null,
		kind,
		origin = null,
		trailing,
	}: Props = $props();

	let armed = $state(false);

	const actionState = $derived(jobActionStateQuery.data(run.id));
	const parent = $derived(jobRunByIdQuery.data(run.parentRunId));
	const followed = $derived(
		run.parentRunId === null ? origin : `After ${parent?.title ?? 'another job'}`,
	);
	const look = $derived(JOB_RUN_STATUS[run.status]);
	const place = $derived(jobPlace(run, run.workstreamId));
	const where = $derived(
		shownIn !== null && run.workstreamId !== shownIn && place ? ` in ${place}` : '',
	);
	const placeName = $derived(shownIn === null ? place : `Job${where} · ${look.label}`);
	const subject = $derived(
		(shownIn === null ? [run.title, place, followed] : [`${run.title} job${where}`, followed])
			.filter(Boolean)
			.join(' · '),
	);
	const transcriptHref = $derived(
		run.workstreamId && run.sessionId
			? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
			: null,
	);
	const cancellable = $derived(['waiting', 'queued', 'running'].includes(run.status));
	const detail = $derived(
		run.status === 'needs-you' || run.status === 'failed' ? run.detail : null,
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
	<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
		{#if run.status === 'running'}
			<BusyIcon size={12} />
		{:else}
			<Icon name={look.icon} size={13} />
		{/if}
	</span>
	{#if kind}
		<ActivityKind label={kind} />
	{/if}
	<span class="min-w-0 flex-1 truncate">
		{#if placeFirst}
			<span class="text-fg-default font-medium">{placeName ?? 'Closed workstream'}</span>
		{:else}
			<span class="text-fg-default font-medium">{run.title}</span>
			{#if placeName}
				<span class="text-fg-tertiary">· {placeName}</span>
			{/if}
		{/if}
		{#if followed}
			<span class="text-fg-tertiary">· {followed}</span>
		{/if}
		{#if run.requests > 1}
			<span class="text-fg-tertiary">· Asked {run.requests} times</span>
		{/if}
	</span>
{/snippet}

{#snippet opener()}
	{#if transcriptHref}
		<Button
			bare
			href={transcriptHref}
			ariaLabel={`Open transcript: ${subject}, ${look.label}`}
			class="focus-visible:ring-border-default/50 flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl pl-2 text-left text-xs outline-none focus-visible:ring-2"
		>
			{@render summary()}
		</Button>
	{:else}
		<Button
			bare
			disabled
			ariaLabel={`${subject}, ${look.label}. The transcript opens once the job starts`}
			class="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-xl pl-2 text-left text-xs"
		>
			{@render summary()}
		</Button>
	{/if}
{/snippet}

<div
	class={[
		'group flex items-center gap-2 rounded-xl pr-1',
		transcriptHref && 'hover:bg-surface-50-hover',
	]}
	data-testid="job-run-row"
	data-job-run-id={run.id}
>
	{#if detail}
		<Tooltip content={detail} placement="left" class="min-w-0 flex-1">
			{@render opener()}
		</Tooltip>
	{:else}
		{@render opener()}
	{/if}
	{@render trailing?.()}
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
		<span class="grid shrink-0 place-items-center">
			<span
				class={[
					'text-fg-tertiary text-2xs pointer-events-none justify-self-end pr-1 tabular-nums [grid-area:1/1]',
					cancellable && 'group-hover:opacity-0 group-has-focus-visible:opacity-0',
				]}
			>
				{jobRunTime(run, nowMs)}
			</span>
			{#if cancellable}
				<span
					class="justify-self-end opacity-0 [grid-area:1/1] group-hover:opacity-100 group-has-focus-visible:opacity-100"
				>
					<Tooltip content="Cancel job" placement="top">
						<IconButton
							variant="ghost"
							size="xs"
							ariaLabel={`Cancel ${run.title}`}
							disabled={actionState.busy}
							data-testid="job-run-cancel"
							onclick={onCancel}
						>
							<Icon name="close" size={12} />
						</IconButton>
					</Tooltip>
				</span>
			{/if}
		</span>
	{/if}
</div>
