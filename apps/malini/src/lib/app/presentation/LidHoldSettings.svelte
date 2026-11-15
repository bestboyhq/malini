<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { holdLidCommand } from '$lib/app/application/commands/hold-lid.command';
	import { loadLidHoldCommand } from '$lib/app/application/commands/load-lid-hold.command';
	import { lidHoldQuery } from '$lib/app/application/queries/lid-hold.query.svelte';
	import { osQuery, type OsPlatform } from '$shared/os/os.api';

	const COPY: Readonly<
		Record<OsPlatform, Readonly<{ about: string; refused: string; unavailable: string }>>
	> = {
		darwin: {
			about:
				'While an agent works, your Mac stays awake with the lid closed. It sleeps once agents finish, or at 5% battery. macOS asks for your password once.',
			refused: "macOS didn't allow it. Malini needs an admin account to change sleep settings.",
			unavailable: 'No way to hold the lid on this Mac, so the lid does what it always does.',
		},
		win32: {
			about:
				'While an agent works, your PC stays awake with the lid closed. It sleeps on its usual timer once agents finish. Malini borrows your lid setting and puts it back.',
			refused: "Windows didn't allow it. This account can't change the power plan.",
			unavailable: 'No lid setting in this power plan, so the lid does what it always does.',
		},
		linux: {
			about:
				'While an agent works, your computer stays awake with the lid closed. It sleeps once agents finish, or at 5% battery. Malini asks systemd, no password needed.',
			refused: "Linux didn't allow it. Malini needs a local desktop session to hold the lid.",
			unavailable: 'No systemd-logind here, so the lid does what it always does.',
		},
	};

	const labelId = $props.id();
	const copy = $derived(COPY[osQuery.data.platform]);

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
			{lidHoldQuery.available ? copy.about : copy.unavailable}
		</p>
		<p class="text-fg-tertiary mt-0.5 text-xs">
			Thanks to {@render credit('https://github.com/krishkalaria12', 'Krish Kalaria')}, who built
			{@render credit('https://github.com/krishkalaria12/close-my-lid', 'Close My Lid')}
		</p>
		{#if lidHoldQuery.refused}
			<p class="text-error-content mt-1 text-xs" role="alert">{copy.refused}</p>
		{/if}
	</div>
	<Switch
		checked={lidHoldQuery.on ?? false}
		disabled={lidHoldQuery.on === null || lidHoldQuery.asking || !lidHoldQuery.available}
		labelledBy={labelId}
		onchange={holdLidCommand}
	/>
</div>
