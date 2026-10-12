<script lang="ts">
	import { untrack } from 'svelte';
	import type { Appearance } from '$lib/app/domain/appearance';
	import { oklchCss } from '$lib/app/domain/oklab';
	import {
		gaugeColor,
		temperatureOf,
		tintAtTemperature,
		TEMPERATURE_COOL_HUE,
		TEMPERATURE_MAX_CHROMA,
		TEMPERATURE_WARM_HUE,
	} from '$lib/app/domain/tint-gauges';
	import GaugeCard from './GaugeCard.svelte';
	import Lever from './Lever.svelte';
	import { kelvinLabel, percentLabel } from './gauge-format';
	import { GaugeNeedle, gaugeStatus } from './gauge-needle.svelte';

	interface Props {
		appearance: Appearance;
		driving: boolean;
		ontune: (patch: Partial<Appearance>) => void;
	}

	let { appearance, driving, ontune }: Props = $props();

	const DETENT = 0.04;
	const TEMPERATURE_RAIL = `linear-gradient(to top, ${oklchCss(gaugeColor(TEMPERATURE_COOL_HUE, TEMPERATURE_MAX_CHROMA))}, ${oklchCss(gaugeColor(0, 0))}, ${oklchCss(gaugeColor(TEMPERATURE_WARM_HUE, TEMPERATURE_MAX_CHROMA))})`;
	const BRIGHTNESS_RAIL = `linear-gradient(to top, ${oklchCss({ l: 0.12, c: 0, h: 0 })}, ${oklchCss({ l: 0.42, c: 0, h: 0 })})`;
	const CONTRAST_RAIL = `linear-gradient(to top, ${oklchCss({ l: 0.3, c: 0, h: 0 })}, ${oklchCss({ l: 0.95, c: 0, h: 0 })})`;

	const needle = new GaugeNeedle(untrack(() => leverValues(appearance)));
	let grabbing = $state(false);

	$effect(() => needle.moveTo(leverValues(appearance), driving));

	function leverValues(current: Appearance): number[] {
		return [temperatureOf(current), current.brightness, current.contrast];
	}

	function detent(value: number): number {
		return Math.abs(value) < DETENT ? 0 : value;
	}
</script>

<GaugeCard title="Levers" status={gaugeStatus(grabbing, needle.following)}>
	<div class="flex w-full items-center justify-evenly gap-2">
		<Lever
			label="Temp"
			format={kelvinLabel}
			top="WARM"
			bottom="COOL"
			rail={TEMPERATURE_RAIL}
			shown={needle.at(0)}
			value={temperatureOf(appearance)}
			onvalue={(temperature) => ontune(tintAtTemperature(temperature))}
			ongrab={() => (grabbing = true)}
			onrelease={() => (grabbing = false)}
		/>
		<Lever
			label="Brightness"
			format={percentLabel}
			top="BRIGHT"
			bottom="DIM"
			rail={BRIGHTNESS_RAIL}
			shown={needle.at(1)}
			value={appearance.brightness}
			onvalue={(brightness) => ontune({ brightness: detent(brightness) })}
			ongrab={() => (grabbing = true)}
			onrelease={() => (grabbing = false)}
		/>
		<Lever
			label="Contrast"
			format={percentLabel}
			top="HIGH"
			bottom="LOW"
			rail={CONTRAST_RAIL}
			shown={needle.at(2)}
			value={appearance.contrast}
			onvalue={(contrast) => ontune({ contrast: detent(contrast) })}
			ongrab={() => (grabbing = true)}
			onrelease={() => (grabbing = false)}
		/>
	</div>
</GaugeCard>
