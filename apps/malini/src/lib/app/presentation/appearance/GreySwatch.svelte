<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import type { Appearance } from '$lib/app/domain/appearance';
	import { greyRamp } from '$lib/app/domain/grey-ramp';
	import { oklchCss } from '$lib/app/domain/oklab';

	interface Props {
		appearance: Appearance;
		label: string;
		pressed: boolean;
		onchoose: () => void;
	}

	let { appearance, label, pressed, onchoose }: Props = $props();

	const SWATCH_SHADES = [19, 9, 2];
	const stripes = $derived.by(() => {
		const ramp = greyRamp(appearance, 'dark');
		return SWATCH_SHADES.map((shade) => {
			const color = ramp[shade]?.color;
			return color ? oklchCss(color) : '';
		});
	});
</script>

<Button
	bare
	ariaPressed={pressed}
	onclick={onchoose}
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
		{#each stripes as stripe, index (index)}
			<span style:background-color={stripe}></span>
		{/each}
	</span>
	<span class="truncate">{label}</span>
</Button>
