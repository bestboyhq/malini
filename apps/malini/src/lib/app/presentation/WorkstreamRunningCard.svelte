<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { WorkstreamRunning } from '$contract/stats';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { formatTimeAgo, WorkstreamRunningList } from '$lib/stats/stats.api';
	import type { WorkstreamChangeTotals } from '$shared/repositories/repositories.api';

	interface Props {
		icon: Snippet;
		iconClass: string;
		label: string;
		branch: string;
		baseBranch: string;
		pullRequestLabel: string | null;
		working: boolean;
		stateLabel: string;
		changeTotals: WorkstreamChangeTotals | undefined;
		running: WorkstreamRunning;
		onopenport: (port: number) => void;
	}

	let {
		icon,
		iconClass,
		label,
		branch,
		baseBranch,
		pullRequestLabel,
		working,
		stateLabel,
		changeTotals,
		running,
		onopenport,
	}: Props = $props();

	const turn = $derived(working ? null : running.turn);
	const totals = $derived(
		changeTotals &&
			(changeTotals.additions > 0 || changeTotals.deletions > 0 || changeTotals.files > 0)
			? changeTotals
			: null,
	);

	let now = $state(Date.now());

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(clock);
	});
</script>

<div class="flex w-88 flex-col text-left" data-testid="workstream-running-card">
	<div class="flex min-w-0 items-center gap-2">
		<span class={['grid h-4 w-4 shrink-0 place-items-center', iconClass || 'text-fg-secondary']}>
			{@render icon()}
		</span>
		<span class="text-fg-default min-w-0 flex-1 truncate text-sm font-medium">
			<SensitiveText text={label} />
		</span>
	</div>
	<div class="flex flex-col pl-6">
		<p class="text-2xs text-fg-tertiary mt-1 truncate font-mono">
			<SensitiveText text={`${branch} → ${baseBranch}`} />
			{#if pullRequestLabel}· {pullRequestLabel}{/if}
		</p>
		<p class="mt-2.5 text-xs leading-relaxed">
			{#if turn?.need}
				<span class="text-warning-content font-medium">Needs you</span>
				<span class="text-fg-tertiary">·</span>
				<span class="text-fg-secondary">{turn.need}</span>
			{:else if turn}
				<span class="text-fg-default font-medium">Done {formatTimeAgo(now - turn.endedAt)}</span>
				{#if turn.outcome}
					<span class="text-fg-tertiary">·</span>
					<span class="text-fg-secondary">{turn.outcome}</span>
				{/if}
			{:else}
				<span class="text-fg-secondary">{stateLabel}</span>
			{/if}
		</p>
		{#if totals}
			<p class="text-2xs text-fg-tertiary mt-0.5 flex gap-1 font-mono tabular-nums">
				{#if totals.additions > 0}
					<span class="text-success-content">+{totals.additions}</span>
				{/if}
				{#if totals.deletions > 0}
					<span class="text-error-content">−{totals.deletions}</span>
				{/if}
				<span>
					{totals.additions > 0 || totals.deletions > 0 ? 'in' : ''}
					{totals.files}
					{totals.files === 1 ? 'file' : 'files'}
				</span>
			</p>
		{/if}
	</div>
	<div class="border-surface-elevated-border -mx-2 my-2 border-t"></div>
	<WorkstreamRunningList {running} {onopenport} />
</div>
