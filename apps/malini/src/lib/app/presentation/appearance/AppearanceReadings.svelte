<script lang="ts">
	import { isNeutral, type Appearance, type Theme } from '$lib/app/domain/appearance';
	import { bodyTextContrast } from '$lib/app/domain/grey-ramp';
	import { chromaName, hueName, temperatureOf } from '$lib/app/domain/tint-gauges';
	import { chromaLabel, degreesLabel, kelvinLabel, percentLabel } from './gauge-format';

	interface Props {
		appearance: Appearance;
		theme: Theme;
	}

	type Reading = Readonly<{ label: string; value: string; detail: string }>;

	let { appearance, theme }: Props = $props();

	const otherTheme: Theme = $derived(theme === 'dark' ? 'light' : 'dark');
	const readings: readonly Reading[] = $derived.by(() => {
		const neutral = isNeutral(appearance);
		const temperature = temperatureOf(appearance);
		return [
			{
				label: 'Hue',
				value: neutral ? '———' : degreesLabel(appearance.hue),
				detail: neutral ? 'neutral' : hueName(appearance.hue),
			},
			{
				label: 'Chroma',
				value: chromaLabel(appearance.chroma),
				detail: chromaName(appearance.chroma),
			},
			{
				label: 'Temperature',
				value: kelvinLabel(temperature),
				detail: direction(temperature, 'daylight', 'warmer than daylight', 'cooler than daylight'),
			},
			{
				label: 'Brightness',
				value: percentLabel(appearance.brightness),
				detail: direction(appearance.brightness, 'default', 'lifted', 'dimmed'),
			},
			{
				label: 'Contrast',
				value: percentLabel(appearance.contrast),
				detail: direction(appearance.contrast, 'default', 'crisper', 'softer'),
			},
			{
				label: 'Body text',
				value: ratioLabel(bodyTextContrast(appearance, theme)),
				detail: `${theme} theme · ${ratioLabel(bodyTextContrast(appearance, otherTheme))} ${otherTheme}`,
			},
		];
	});

	function direction(value: number, still: string, up: string, down: string): string {
		if (Math.abs(value) < 0.04) return still;
		return value > 0 ? up : down;
	}

	function ratioLabel(ratio: number): string {
		return `${ratio.toFixed(1)}:1`;
	}
</script>

<div class="@container">
	<dl class="grid grid-cols-3 gap-1.5 @3xl:grid-cols-6">
		{#each readings as reading (reading.label)}
			<div
				class="bg-surface-100 border-surface-100-border flex min-w-0 flex-col gap-1 rounded-xl border-[0.5px] px-3 py-2.5 shadow-xs"
			>
				<dt class="text-fg-tertiary text-2xs">{reading.label}</dt>
				<dd
					class="text-fg-default font-mono text-[22px] leading-[30px] whitespace-nowrap tabular-nums"
				>
					{reading.value}
				</dd>
				<dd class="text-fg-secondary text-2xs truncate">{reading.detail}</dd>
			</div>
		{/each}
	</dl>
</div>
