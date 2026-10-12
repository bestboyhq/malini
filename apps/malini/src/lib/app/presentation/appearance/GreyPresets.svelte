<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { DEFAULT_APPEARANCE, GREY_PRESETS, type GreyPreset } from '$lib/app/domain/appearance';
	import { greyRamp } from '$lib/app/domain/grey-ramp';
	import { oklchCss } from '$lib/app/domain/oklab';

	interface Props {
		selected: GreyPreset | null;
		onchoose: (preset: GreyPreset) => void;
	}

	let { selected, onchoose }: Props = $props();

	const SWATCH_SHADES = [19, 9, 2];
	const SWATCHES = GREY_PRESETS.map((preset) => {
		const ramp = greyRamp({ ...DEFAULT_APPEARANCE, ...preset }, 'dark');
		return {
			preset,
			stripes: SWATCH_SHADES.map((shade) => {
				const color = ramp[shade]?.color;
				return color ? oklchCss(color) : '';
			}),
		};
	});
</script>

<div class="@container">
	<div class="grid grid-cols-5 gap-2 px-2 pt-0.5 pb-2.5 @2xl:grid-cols-10">
		{#each SWATCHES as swatch (swatch.preset.name)}
			{@const pressed = selected?.name === swatch.preset.name}
			<Button
				bare
				ariaPressed={pressed}
				onclick={() => onchoose(swatch.preset)}
				class={[
					'flex min-w-0 flex-col gap-1.5 text-[11.5px]',
					pressed ? 'text-fg-default' : 'text-fg-tertiary hover:text-fg-secondary',
				]}
			>
				<span
					class={[
						'grid h-9 grid-rows-[2fr_1fr_1fr] overflow-hidden rounded-[9px] shadow-xs',
						pressed
							? 'ring-button-primary ring-offset-surface-root ring-[1.5px] ring-offset-2'
							: 'ring-border-subtle ring-[0.5px]',
					]}
				>
					{#each swatch.stripes as stripe, index (index)}
						<span style:background-color={stripe}></span>
					{/each}
				</span>
				{swatch.preset.name}
			</Button>
		{/each}
	</div>
</div>
