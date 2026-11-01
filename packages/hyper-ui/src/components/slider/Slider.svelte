<script lang="ts">
	import { SLIDER_THUMB_PX, sliderPosition } from './slider-position';

	interface Props {
		value: number;
		min: number;
		max: number;
		step: number;
		marker?: number | undefined;
		ariaLabel?: string | undefined;
		labelledBy?: string | undefined;
		valueText?: string | undefined;
		disabled?: boolean;
		oninput?: (value: number) => void;
		onchange?: (value: number) => void;
	}

	let {
		value,
		min,
		max,
		step,
		marker,
		ariaLabel,
		labelledBy,
		valueText,
		disabled = false,
		oninput,
		onchange,
	}: Props = $props();
</script>

<div class="relative flex h-7 w-full items-center" style:--slider-thumb="{SLIDER_THUMB_PX}px">
	<div class="bg-surface-150 relative h-1 w-full rounded-full">
		<div
			class="bg-surface-invert/40 absolute inset-y-0 left-0 rounded-full"
			style:width={sliderPosition(value, min, max)}
		></div>
		{#if marker !== undefined}
			<span
				class="bg-brand-foreground absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
				style:left={sliderPosition(marker, min, max)}
			></span>
		{/if}
	</div>
	<input
		type="range"
		class="slider absolute inset-0 h-7 w-full"
		{min}
		{max}
		{step}
		{value}
		{disabled}
		aria-label={ariaLabel}
		aria-labelledby={labelledBy}
		aria-valuetext={valueText}
		oninput={(event) => oninput?.(Number(event.currentTarget.value))}
		onchange={(event) => onchange?.(Number(event.currentTarget.value))}
	/>
</div>

<style>
	.slider {
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	.slider:disabled {
		cursor: default;
	}

	.slider::-webkit-slider-runnable-track {
		height: 1.75rem;
		background: transparent;
	}

	.slider::-webkit-slider-thumb {
		width: var(--slider-thumb);
		height: var(--slider-thumb);
		margin-top: calc((1.75rem - var(--slider-thumb)) / 2);
		border-radius: 9999px;
		appearance: none;
		background: var(--color-button-primary);
		box-shadow: var(--shadow-md);
		transition: scale 120ms;
	}

	.slider:enabled:hover::-webkit-slider-thumb {
		scale: 1.15;
	}

	.slider:focus-visible {
		outline: none;
	}

	.slider:focus-visible::-webkit-slider-thumb {
		box-shadow:
			0 0 0 2px var(--color-border-default),
			var(--shadow-md);
	}

	@media (prefers-reduced-motion: reduce) {
		.slider::-webkit-slider-thumb {
			transition: none;
		}
	}
</style>
