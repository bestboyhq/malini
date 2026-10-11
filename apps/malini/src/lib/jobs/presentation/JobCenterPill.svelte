<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Icon } from '$hyper-ui/icons';
	import type { JobCenterCounts } from './job-center-summary';
	import JobCenterHeader from './JobCenterHeader.svelte';
	import JobRunList from './JobRunList.svelte';

	interface Props {
		active: readonly JobRunRecord[];
		finished: readonly JobRunRecord[];
		nowMs: number;
		counts: JobCenterCounts;
		summary: string;
	}

	let { active, finished, nowMs, counts, summary }: Props = $props();

	let open = $state(false);
	let trigger = $state<HTMLAnchorElement | HTMLButtonElement | null>(null);

	const label = $derived(
		counts.running > 0
			? `${counts.running} running`
			: counts.queued > 0
				? `${counts.queued} queued`
				: 'Jobs',
	);

	function close(): void {
		open = false;
	}
</script>

<Button
	bare
	bind:element={trigger}
	ariaLabel={`Jobs: ${summary}`}
	ariaExpanded={open}
	ariaHasPopup="dialog"
	active={open}
	class="border-surface-elevated-border bg-surface-elevated hover:bg-surface-elevated-hover focus-visible:ring-border-default/50 flex h-8 cursor-pointer items-center gap-2 rounded-full border-[0.5px] pr-1.5 pl-3 text-xs shadow-lg outline-none focus-visible:ring-2"
	data-testid="job-center-pill"
	onclick={() => (open = !open)}
>
	<span class="text-fg-secondary grid size-3.5 place-items-center" aria-hidden="true">
		{#if counts.running > 0}
			<LoadingCircle size={12} />
		{:else}
			<Icon name="checklist" size={13} />
		{/if}
	</span>
	<span class="text-fg-default font-medium tabular-nums" aria-hidden="true">{label}</span>
	{#if counts.needsYou > 0}
		<span
			class="bg-warning text-warning-content flex h-5 items-center gap-0.5 rounded-full px-1.5 font-semibold tabular-nums"
			aria-hidden="true"
		>
			<Icon name="alert" size={11} />
			{counts.needsYou}
		</span>
	{:else}
		<span class="w-1.5" aria-hidden="true"></span>
	{/if}
</Button>

<DropdownLayer
	{open}
	anchor={trigger}
	onclose={close}
	side="top"
	align="end"
	role={null}
	panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1"
	testId="job-center-popover"
	owner="job-center"
>
	<div role="dialog" aria-label="Jobs">
		<JobCenterHeader {summary} onopen={close} />
		<div class="max-h-[min(26rem,60vh)] overflow-y-auto">
			<JobRunList {active} {finished} {nowMs} onopen={close} />
		</div>
	</div>
</DropdownLayer>
