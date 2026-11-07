<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { holdLidCommand } from '$lib/app/application/commands/hold-lid.command';
	import { loadLidHoldCommand } from '$lib/app/application/commands/load-lid-hold.command';
	import { lidHoldQuery } from '$lib/app/application/queries/lid-hold.query.svelte';

	const labelId = $props.id();

	onMount(loadLidHoldCommand);
</script>

{#snippet credit(href: string, label: string)}
	<a
		{href}
		target="_blank"
		rel="noreferrer"
		class="text-fg-secondary hover:text-fg-default underline-offset-2 hover:underline"
	>
		{label}
	</a>
{/snippet}

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3">
	<div class="min-w-0">
		<h3 id={labelId} class="text-fg-default text-sm font-medium">
			Keep working with the lid closed
		</h3>
		<p class="text-fg-tertiary text-xs">
			While an agent works, your Mac stays awake with the lid closed. It sleeps once agents finish,
			or at 5% battery. macOS asks for your password once.
		</p>
		<p class="text-fg-tertiary mt-0.5 text-xs">
			From {@render credit('https://github.com/krishkalaria12/close-my-lid', 'Close My Lid')} by
			{@render credit('https://github.com/krishkalaria12', 'Krish Kalaria')}.
		</p>
		{#if lidHoldQuery.refused}
			<p class="text-error-content mt-1 text-xs" role="alert">
				macOS didn't allow it. Malini needs an admin account to change sleep settings.
			</p>
		{/if}
	</div>
	<Switch
		checked={lidHoldQuery.on ?? false}
		disabled={lidHoldQuery.on === null || lidHoldQuery.asking}
		labelledBy={labelId}
		onchange={holdLidCommand}
	/>
</div>
