<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { loadUsageDataCommand } from '$lib/app/application/commands/load-usage-data.command';
	import { shareUsageDataCommand } from '$lib/app/application/commands/share-usage-data.command';
	import { usageDataQuery } from '$lib/app/application/queries/usage-data.query.svelte';

	const shared = $derived(usageDataQuery.data);

	onMount(() => {
		loadUsageDataCommand();
	});
</script>

<section aria-labelledby="usage-data-heading">
	<h2 id="usage-data-heading" class="text-fg-default text-sm font-medium">Privacy</h2>

	<div
		class="border-surface-50-border bg-surface-50 mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl border-[0.5px] px-4 py-3"
	>
		<div class="min-w-0">
			<h3 id="usage-data-label" class="text-fg-default text-sm font-medium">Share usage data</h3>
			<p class="text-fg-tertiary text-xs">
				Anonymous feature usage and errors. Never your code, prompts, paths or keys.
			</p>
		</div>
		<Switch
			checked={shared ?? false}
			disabled={shared === null}
			labelledBy="usage-data-label"
			onchange={shareUsageDataCommand}
		/>
	</div>
</section>
