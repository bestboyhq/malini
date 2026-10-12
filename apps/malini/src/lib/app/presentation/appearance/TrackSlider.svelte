<script lang="ts">
	import { gaugeDrag } from './gauge-pointer';
	import ScaleMarks from './ScaleMarks.svelte';
	import type { ScaleTick } from './gauge-scale';

	interface Props {
		label: string;
		reading: string;
		track: string;
		shown: number;
		value: number;
		onvalue: (value: number) => void;
		ongrab: () => void;
		onrelease: () => void;
	}

	let { label, reading, track, shown, value, onvalue, ongrab, onrelease }: Props = $props();

	const THUMB = 16;
	const KEY_STEPS: Readonly<Record<string, number>> = {
		ArrowRight: 0.01,
		ArrowUp: 0.01,
		ArrowLeft: -0.01,
		ArrowDown: -0.01,
		PageUp: 0.1,
		PageDown: -0.1,
	};

	let width = $state(0);
	const ticks: ScaleTick[] = $derived(
		Array.from({ length: 25 }, (_, index) => {
			const x = Math.round(THUMB / 2 + ((width - THUMB) * index) / 24) + 0.5;
			return { x1: x, y1: 0, x2: x, y2: 5, major: false };
		}),
	);

	function valueAt(fraction: number): number {
		if (width <= THUMB) return value;
		return clamp((fraction * width - THUMB / 2) / (width - THUMB));
	}

	function onkeydown(event: KeyboardEvent): void {
		const step = KEY_STEPS[event.key];
		if (step === undefined) return;
		event.preventDefault();
		onvalue(clamp(value + step));
	}

	function clamp(next: number): number {
		return Math.min(1, Math.max(0, next));
	}
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1">
	<span class="text-fg-secondary text-xs">{label}</span>
	<span class="text-fg-default text-2xs text-right font-mono tabular-nums">{reading}</span>
	<div class="col-span-2 pb-1.5">
		<div
			class="focus-visible:ring-border-default/50 relative h-5 cursor-pointer touch-none rounded-full focus-visible:ring-2"
			bind:clientWidth={width}
			role="slider"
			tabindex="0"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(value * 100)}
			aria-valuetext={reading}
			{onkeydown}
			{@attach gaugeDrag({
				onmove: ([fraction]) => onvalue(valueAt(fraction)),
				ongrab: () => ongrab(),
				onrelease: () => onrelease(),
				handle: () => undefined,
			})}
		>
			<div
				class="absolute inset-x-0 top-[7px] h-1.5 rounded-[3px] shadow-xs"
				style:background={track}
			></div>
			<span
				class="bg-button-primary absolute top-1/2 size-4 -translate-1/2 rounded-full shadow-md"
				style:left="{THUMB / 2 + clamp(shown) * (width - THUMB)}px"
			></span>
		</div>
		<svg class="mt-0.5 block" {width} height="5" aria-hidden="true">
			<ScaleMarks {ticks} />
		</svg>
	</div>
</div>
