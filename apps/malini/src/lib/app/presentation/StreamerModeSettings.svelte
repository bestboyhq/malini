<script lang="ts">
	import { chooseStreamerModeCommand } from '$lib/app/application/commands/choose-streamer-mode.command';
	import { streamerModeQuery } from '$lib/app/application/queries/streamer-mode.query.svelte';
	import { STREAMER_MODES, type StreamerMode } from '$lib/app/domain/streamer-mode';
	import ChoiceSwitch from './settings/ChoiceSwitch.svelte';

	const LABELS: Readonly<Record<StreamerMode, string>> = { auto: 'Auto', on: 'On', off: 'Off' };

	const mode = $derived(streamerModeQuery.mode);
	const detected = $derived(mode === 'auto' && streamerModeQuery.streaming);
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
	<div class="min-w-0">
		<h3 class="text-fg-default text-sm font-medium">Streamer mode</h3>
		<p class="text-fg-tertiary text-xs">
			Masks email addresses and your user name in paths with asterisks, keeping the first and last
			letters so you can tell your own. Auto masks while OBS or another streaming app runs, or
			while an app records the screen. Click a masked one to show it.
		</p>
		{#if detected}
			<p class="text-fg-secondary mt-0.5 text-xs" data-testid="streamer-mode-detected">
				Streaming or screen recording detected, so Malini masks now.
			</p>
		{/if}
	</div>
	<ChoiceSwitch
		label="Streamer mode"
		choices={STREAMER_MODES}
		labels={LABELS}
		selected={mode}
		onchoose={chooseStreamerModeCommand}
	/>
</div>
