<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { compactOutputCommand } from '$lib/app/application/commands/compact-output.command';
	import { loadCompactOutputCommand } from '$lib/app/application/commands/load-compact-output.command';
	import { compactOutputQuery } from '$lib/app/application/queries/compact-output.query.svelte';

	const labelId = $props.id();

	onMount(loadCompactOutputCommand);
</script>

<div
	class="border-surface-50-border bg-surface-50 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border-[0.5px] px-4 py-3"
>
	<div class="min-w-0">
		<h3 id={labelId} class="text-fg-default text-sm font-medium">Trim command output</h3>
		<p class="text-fg-tertiary text-xs">
			Malini cuts the noise from git, grep, ls and gh output. Fewer tokens, and agents won't miss it
		</p>
	</div>
	<Switch
		checked={compactOutputQuery.on ?? false}
		disabled={compactOutputQuery.on === null}
		labelledBy={labelId}
		onchange={compactOutputCommand}
	/>
</div>
