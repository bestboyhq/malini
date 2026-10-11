<script lang="ts">
	import { untrack } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { MAX_TINT_CHROMA, type Appearance } from '$lib/app/domain/appearance';
	import { oklchCss } from '$lib/app/domain/oklab';
	import { chromaAtReach, gaugeColor, reachOfChroma, type Tint } from '$lib/app/domain/tint-gauges';
	import GaugeCard from './GaugeCard.svelte';
	import TrackSlider from './TrackSlider.svelte';
	import { chromaLabel, degreesLabel } from './gauge-format';
	import { GaugeNeedle, gaugeStatus } from './gauge-needle.svelte';

	interface Props {
		appearance: Appearance;
		driving: boolean;
		ontune: (tint: Tint) => void;
		class?: ClassValue;
	}

	let { appearance, driving, ontune, class: className }: Props = $props();

	const HUE_TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, index) =>
		oklchCss(gaugeColor(index * 30, 0.04)),
	).join(', ')})`;

	const needle = new GaugeNeedle(untrack(() => sliderValues(appearance)));
	let grabbing = $state(false);
	const chromaTrack = $derived(
		`linear-gradient(to right, ${oklchCss(gaugeColor(0, 0))}, ${oklchCss(gaugeColor(appearance.hue, MAX_TINT_CHROMA))})`,
	);

	$effect(() => needle.moveTo(sliderValues(appearance), driving));

	function sliderValues(current: Appearance): number[] {
		return [current.hue / 360, reachOfChroma(current.chroma)];
	}
</script>

<GaugeCard title="Fine tune" status={gaugeStatus(grabbing, needle.following)} class={className}>
	<div class="grid w-full grid-cols-2 gap-x-6">
		<TrackSlider
			label="Hue"
			reading={degreesLabel(needle.at(0) * 360)}
			track={HUE_TRACK}
			shown={needle.at(0)}
			value={appearance.hue / 360}
			onvalue={(fraction) => ontune({ hue: Math.min(fraction, 0.9999) * 360 })}
			ongrab={() => (grabbing = true)}
			onrelease={() => (grabbing = false)}
		/>
		<TrackSlider
			label="Chroma"
			reading={chromaLabel(chromaAtReach(needle.at(1)))}
			track={chromaTrack}
			shown={needle.at(1)}
			value={reachOfChroma(appearance.chroma)}
			onvalue={(reach) => ontune({ chroma: chromaAtReach(reach) })}
			ongrab={() => (grabbing = true)}
			onrelease={() => (grabbing = false)}
		/>
	</div>
</GaugeCard>
