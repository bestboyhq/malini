<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AutomationRunRecord } from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { cancelAutomationRunCommand } from '$lib/automations/application/commands/cancel-automation-run.command';
	import { automationActionStateQuery } from '$lib/automations/application/queries/automation-action-state.query.svelte';
	import { automationRunByIdQuery } from '$lib/automations/application/queries/automation-run-by-id.query.svelte';
	import ActivityKind from './automations/ActivityKind.svelte';
	import { automationPlace } from './automation-place';
	import { AUTOMATION_RUN_STATUS } from './automation-run-status';
	import { automationRunTime } from './automation-run-time';

	interface Props {
		run: AutomationRunRecord;
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

	const actionState = $derived(automationActionStateQuery.data(run.id));
	const parent = $derived(automationRunByIdQuery.data(run.parentRunId));
	const followed = $derived(
		run.parentRunId === null ? origin : `After ${parent?.title ?? 'another automation'}`,
	);
	const look = $derived(AUTOMATION_RUN_STATUS[run.status]);
	const place = $derived(automationPlace(run, run.workstreamId));
	const where = $derived(
		shownIn !== null && run.workstreamId !== shownIn && place ? ` in ${place}` : '',
	);
	const placeName = $derived(shownIn === null ? place : `Automation${where} · ${look.label}`);
	const subject = $derived(
		(shownIn === null
			? [run.title, place, followed]
			: [`${run.title} automation${where}`, followed]
		)
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
		cancelAutomationRunCommand(run);
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
			ariaLabel={`${subject}, ${look.label}. The transcript opens once the automation starts`}
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
	data-testid="automation-run-row"
	data-automation-run-id={run.id}
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
			data-testid="automation-run-cancel-confirm"
			onclick={onCancel}
		>
			Cancel automation
		</Button>
	{:else}
		<span class="grid shrink-0 place-items-center">
			<span
				class={[
					'text-fg-tertiary text-2xs pointer-events-none justify-self-end pr-1 tabular-nums [grid-area:1/1]',
					cancellable && 'group-hover:opacity-0 group-has-focus-visible:opacity-0',
				]}
			>
				{automationRunTime(run, nowMs)}
			</span>
			{#if cancellable}
				<span
					class="justify-self-end opacity-0 [grid-area:1/1] group-hover:opacity-100 group-has-focus-visible:opacity-100"
				>
					<Tooltip content="Cancel automation" placement="top">
						<IconButton
							variant="ghost"
							size="xs"
							ariaLabel={`Cancel ${run.title}`}
							disabled={actionState.busy}
							data-testid="automation-run-cancel"
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
