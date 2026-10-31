<script lang="ts">
	import { onMount } from 'svelte';
	import type { UsageReportAge } from '$contract/system';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Icon } from '$hyper-ui/icons';
	import { loadUsageDataCommand } from '$lib/app/application/commands/load-usage-data.command';
	import { shareUsageDataCommand } from '$lib/app/application/commands/share-usage-data.command';
	import { usageDataQuery } from '$lib/app/application/queries/usage-data.query.svelte';
	import { usageReportQuery } from '$lib/app/application/queries/usage-report.query.svelte';

	const USING_FOR: Readonly<Record<UsageReportAge, string>> = {
		day_1: 'a day',
		week_1: 'under a week',
		month_1: 'under a month',
		later: 'over a month',
	};

	const shared = $derived(usageDataQuery.data);
	const report = $derived(usageReportQuery.data);
	const rows = $derived(
		report
			? [
					['Workstreams started', String(report.started)],
					['Prompts', String(report.prompts)],
					['Merged', String(report.merged)],
					['Archived without merging', String(report.archived)],
					...(report.turns === null ? [] : [['Prompts per merge', String(report.turns)]]),
					...(report.minutes === null ? [] : [['Minutes to merge', String(report.minutes)]]),
					['Using Malini for', USING_FOR[report.age]],
				]
			: [],
	);
	const receiptId = $props.id();
	let open = $state(false);

	onMount(() => {
		loadUsageDataCommand();
	});
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3">
	<div class="min-w-0">
		<h3 id="usage-data-label" class="text-fg-default text-sm font-medium">Share usage data</h3>
		<p class="text-fg-tertiary text-xs">
			Once a day, Malini sends a few counts, like how many workstreams you started and merged. They
			show us where work gets stuck and what to fix first.
		</p>
		{#if shared}
			<Button
				bare
				class="text-fg-default mt-0.5 inline-flex cursor-pointer items-center gap-1 text-xs hover:underline"
				ariaExpanded={open}
				ariaControls={receiptId}
				onclick={() => (open = !open)}
			>
				Yesterday's numbers
				<Icon
					name="chevron-down"
					size={12}
					class={['transition-transform motion-reduce:transition-none', !open && '-rotate-90']}
				/>
			</Button>
			{#if open}
				<div
					id={receiptId}
					class="bg-surface-root border-border-default text-2xs mt-2.5 max-w-[520px] rounded-[10px] border-[0.5px] px-3 py-2.5"
				>
					{#if rows.length}
						<dl class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-x-3.5 gap-y-1">
							{#each rows as [label, value] (label)}
								<dt class="text-fg-tertiary">{label}</dt>
								<dd class="text-fg-default text-right tabular-nums">{value}</dd>
							{/each}
						</dl>
						<p class="text-fg-tertiary border-surface-50-border mt-2 border-t-[0.5px] pt-2">
							It also pings when Malini opens or finishes a run, and names the errors it hits.
							<br />
							Nothing in it says it's you.
						</p>
					{:else}
						<p class="text-fg-tertiary">Nothing happened yesterday, so nothing went out.</p>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
	<Switch
		checked={shared ?? false}
		disabled={shared === null}
		labelledBy="usage-data-label"
		onchange={shareUsageDataCommand}
	/>
</div>
