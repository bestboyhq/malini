<script lang="ts">
	import type { Snippet } from 'svelte';
	import { oklchCss, type Oklch } from '$lib/app/domain/oklab';
	import type { GaugePoint } from '$lib/app/domain/tint-gauges';
	import { arrowNudge, gaugeDrag } from './gauge-pointer';
	import { paintGauge } from './paint-gauge';

	interface Props {
		label: string;
		valueText: string;
		width: number;
		height: number;
		inset: number;
		point: GaugePoint;
		colorAt: (point: GaugePoint) => Oklch;
		onmove: (point: GaugePoint) => void;
		onnudge: (right: number, up: number) => void;
		onreset: () => void;
		ongrab: () => void;
		onrelease: () => void;
		scale: Snippet;
	}

	let {
		label,
		valueText,
		width,
		height,
		inset,
		point,
		colorAt,
		onmove,
		onnudge,
		onreset,
		ongrab,
		onrelease,
		scale,
	}: Props = $props();

	let held = $state(false);
	let puck: HTMLSpanElement | undefined = $state();
	const [u, v] = $derived(point);
</script>

<div
	class={['relative mx-auto shrink-0 touch-none', held && 'cursor-grabbing [&_*]:cursor-grabbing']}
	style:width="{width}px"
	style:height="{height}px"
>
	<canvas
		class="absolute rounded-full"
		style:left="{inset}px"
		style:top="{inset}px"
		style:width="calc(100% - {inset * 2}px)"
		style:height="calc(100% - {inset * 2}px)"
		{@attach paintGauge((at) => colorAt(at))}
	></canvas>
	<svg
		class="pointer-events-none absolute inset-0 overflow-visible"
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		aria-hidden="true"
	>
		{@render scale()}
	</svg>
	<div
		class="focus-visible:ring-border-default/50 absolute cursor-crosshair rounded-full focus-visible:ring-2"
		style:left="{inset}px"
		style:top="{inset}px"
		style:right="{inset}px"
		style:bottom="{inset}px"
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuetext={valueText}
		aria-valuenow={Math.round(u * 100)}
		aria-valuemin={0}
		aria-valuemax={100}
		onkeydown={arrowNudge((right, up) => onnudge(right, up))}
		ondblclick={() => onreset()}
		{@attach gaugeDrag({
			onmove: (at) => onmove(at),
			ongrab: () => {
				held = true;
				ongrab();
			},
			onrelease: () => {
				held = false;
				onrelease();
			},
			handle: () => puck,
		})}
	>
		<span
			bind:this={puck}
			class="border-button-primary absolute size-3.5 -translate-1/2 cursor-grab rounded-full border-2 shadow-md before:absolute before:-inset-[9px] before:rounded-full before:content-['']"
			style:left="{u * 100}%"
			style:top="{v * 100}%"
			style:background-color={oklchCss(colorAt(point))}
		></span>
	</div>
</div>
