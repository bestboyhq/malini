<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { switchMomentsCommand } from '$lib/stats/application/commands/switch-moments.command';
	import { momentsOnQuery } from '$lib/stats/application/queries/moments-on.query.svelte';

	const switchId = $props.id();
</script>

<div
	class="border-surface-50-border bg-surface-50 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border-[0.5px] px-4 py-3"
>
	<div class="min-w-0">
		<h3 id={`${switchId}-label`} class="text-fg-default text-sm font-medium">Milestone cards</h3>
		<p class="text-fg-tertiary text-xs">
			Show your card in the sidebar when you reach a streak, a best day, or another thousand runs.
		</p>
	</div>
	<Switch
		checked={momentsOnQuery.data}
		labelledBy={`${switchId}-label`}
		onchange={switchMomentsCommand}
	/>
</div>
