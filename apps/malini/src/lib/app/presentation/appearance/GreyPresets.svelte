<script lang="ts">
	import { DEFAULT_APPEARANCE, GREY_PRESETS, type GreyPreset } from '$lib/app/domain/appearance';
	import GreySwatch from './GreySwatch.svelte';

	interface Props {
		selected: GreyPreset | null;
		onchoose: (preset: GreyPreset) => void;
	}

	let { selected, onchoose }: Props = $props();
</script>

<div class="@container">
	<div class="grid grid-cols-5 gap-2 px-2 pt-0.5 pb-2.5 @2xl:grid-cols-10">
		{#each GREY_PRESETS as preset (preset.name)}
			<GreySwatch
				appearance={{ ...DEFAULT_APPEARANCE, ...preset }}
				label={preset.name}
				pressed={selected?.name === preset.name}
				onchoose={() => onchoose(preset)}
			/>
		{/each}
	</div>
</div>
