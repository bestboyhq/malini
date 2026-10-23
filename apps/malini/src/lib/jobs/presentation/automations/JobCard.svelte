<script lang="ts">
	import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import type { JobTrigger, RoutineStatus } from '$contract/routines';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Icon } from '$hyper-ui/icons';
	import { jobHref } from '$shared/router/routes-hrefs';
	import { instructionsPreview } from '../job-definition-copy';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { jobRunTime } from '../job-run-time';
	import type { ActionState } from './automations-state.svelte';
	import { builtinTrigger, jobTriggerLook, runModeLabel, whenClause } from './triggers';

	interface Props {
		job: JobDefinitionRecord;
		trigger: JobTrigger | null;
		triggerState: ActionState;
		last: JobRunRecord | null;
		nowMs: number;
		ontrigger: (trigger: JobTrigger | null) => void;
	}

	let { job, trigger, triggerState, last, nowMs, ontrigger }: Props = $props();

	let statusBeforeOff = $state<RoutineStatus>('candidate');

	const look = $derived(jobTriggerLook(job, trigger));
	const builtIn = $derived(builtinTrigger(job) !== null);

	function onToggle(on: boolean): void {
		if (trigger === null) return;
		if (on) {
			ontrigger({ ...trigger, status: statusBeforeOff });
			return;
		}
		statusBeforeOff = trigger.status;
		ontrigger({ ...trigger, status: 'draft' });
	}
</script>

<article
	class="border-surface-50-border bg-surface-50 relative flex w-full flex-col rounded-xl border-[0.5px]"
	aria-label={job.name}
	data-testid="job-card"
>
	<Button
		bare
		href={jobHref(job.id)}
		ariaLabel={`Set up ${job.name}`}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2"
	/>
	<div class="pointer-events-none relative flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
		<div class="flex min-w-0 items-center gap-2">
			<span
				class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
				aria-hidden="true"
			>
				<Icon name={look.icon} size={13} />
			</span>
			<span class="text-fg-tertiary min-w-0 truncate text-xs">{whenClause(look)}</span>
		</div>
		<div class="flex flex-col gap-1">
			<h3 class="text-fg-default truncate text-sm font-semibold">{job.name}</h3>
			<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">
				{instructionsPreview(job.instructions)}
			</p>
			{#if triggerState.error}
				<p class="text-error-content text-xs" role="alert">{triggerState.error}</p>
			{/if}
		</div>
	</div>
	<div
		class="border-surface-50-border pointer-events-none relative flex h-11 items-center gap-2 border-t-[0.5px] px-4 text-xs"
	>
		{#if last}
			{@const status = JOB_RUN_STATUS[last.status]}
			<span class={['flex shrink-0 items-center gap-1', status.tone]}>
				<Icon name={status.icon} size={12} />
				{status.label}
			</span>
			<span class="text-fg-tertiary min-w-0 flex-1 truncate tabular-nums">
				{jobRunTime(last, nowMs)}
			</span>
		{:else}
			<span class="text-fg-tertiary min-w-0 flex-1 truncate">No runs yet</span>
		{/if}
		{#if builtIn}
			<span class="text-fg-tertiary shrink-0">Runs on its own</span>
		{:else if trigger === null}
			<span class="text-fg-tertiary shrink-0">Runs when you run it</span>
		{:else}
			<span class="text-fg-tertiary shrink-0">{runModeLabel(trigger.status)}</span>
			<Switch
				checked={trigger.status !== 'draft'}
				disabled={triggerState.busy}
				ariaLabel={job.name}
				class="pointer-events-auto"
				onchange={onToggle}
			/>
		{/if}
	</div>
</article>
