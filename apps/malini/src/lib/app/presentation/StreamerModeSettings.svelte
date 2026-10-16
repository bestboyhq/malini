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
			Blurs email addresses and your user name in paths. Auto blurs while OBS or another streaming
			app runs.
		</p>
		{#if detected}
			<p class="text-fg-secondary mt-0.5 text-xs" data-testid="streamer-mode-detected">
				A streaming app is running, so malini blurs now.
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
