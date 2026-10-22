<script lang="ts">
	import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Icon } from '$hyper-ui/icons';
	import { instructionsPreview } from '../job-definition-copy';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { jobRunTime } from '../job-run-time';
	import {
		LAB_RUN_MODES,
		labIsManual,
		labTrigger,
		labWhenClause,
		type LabJobSetup,
	} from './lab-triggers';

	interface Props {
		job: JobDefinitionRecord;
		setup: LabJobSetup;
		last: JobRunRecord | null;
		nowMs: number;
		onopen: () => void;
		ontoggle: (on: boolean) => void;
	}

	let { job, setup, last, nowMs, onopen, ontoggle }: Props = $props();

	const manual = $derived(labIsManual(setup));
	const modeLabel = $derived(
		LAB_RUN_MODES.find((option) => option.value === setup.mode)?.label ?? '',
	);
</script>

<article
	class="border-surface-50-border bg-surface-50 relative flex w-full flex-col rounded-xl border-[0.5px]"
	aria-label={job.name}
>
	<Button
		bare
		ariaLabel={`Set up ${job.name}`}
		ariaHasPopup="dialog"
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2"
		onclick={onopen}
	/>
	<div class="pointer-events-none relative flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
		<div class="flex min-w-0 items-center gap-2">
			<span
				class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
				aria-hidden="true"
			>
				<Icon name={labTrigger(setup).icon} size={13} />
			</span>
			<span class="text-fg-tertiary min-w-0 truncate text-xs">{labWhenClause(setup)}</span>
		</div>
		<div class="flex flex-col gap-1">
			<h3 class="text-fg-default truncate text-sm font-semibold">{job.name}</h3>
			<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">
				{instructionsPreview(job.instructions)}
			</p>
		</div>
	</div>
	<div
		class="border-surface-50-border pointer-events-none relative flex h-11 items-center gap-2 border-t-[0.5px] px-4 text-xs"
	>
		{#if last}
			{@const look = JOB_RUN_STATUS[last.status]}
			<span class={['flex shrink-0 items-center gap-1', look.tone]}>
				<Icon name={look.icon} size={12} />
				{look.label}
			</span>
			<span class="text-fg-tertiary min-w-0 flex-1 truncate tabular-nums">
				{jobRunTime(last, nowMs)}
			</span>
		{:else}
			<span class="text-fg-tertiary min-w-0 flex-1 truncate">No runs yet</span>
		{/if}
		{#if manual}
			<span class="text-fg-tertiary shrink-0">Runs when you run it</span>
		{:else}
			<span class="text-fg-tertiary shrink-0">{modeLabel}</span>
			<Switch
				checked={setup.mode !== 'off'}
				ariaLabel={job.name}
				class="pointer-events-auto"
				onchange={ontoggle}
			/>
		{/if}
	</div>
</article>
