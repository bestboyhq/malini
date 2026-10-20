<script lang="ts">
	import { gaugeDrag } from './gauge-pointer';
	import type { ScaleTick } from './gauge-scale';
	import ScaleMarks from './ScaleMarks.svelte';

	interface Props {
		label: string;
		format: (value: number) => string;
		top: string;
		bottom: string;
		rail: string;
		shown: number;
		value: number;
		onvalue: (value: number) => void;
		ongrab: () => void;
		onrelease: () => void;
	}

	let { label, format, top, bottom, rail, shown, value, onvalue, ongrab, onrelease }: Props =
		$props();

	const WIDTH = 60;
	const HEIGHT = 176;
	const TRAVEL_INSET = 8;
	const TRAVEL = HEIGHT - TRAVEL_INSET * 2;
	const KEY_STEPS: Readonly<Record<string, number>> = {
		ArrowUp: 0.05,
		ArrowDown: -0.05,
		PageUp: 0.2,
		PageDown: -0.2,
	};
	const TICKS: readonly ScaleTick[] = Array.from({ length: 21 }, (_, index) => {
		const major = index % 5 === 0;
		const y = TRAVEL_INSET + (TRAVEL * index) / 20 + 0.5;
		const reach = major ? 14 : 8;
		return [
			{ x1: 4 + 14 - reach, y1: y, x2: 18, y2: y, major },
			{ x1: WIDTH - 18, y1: y, x2: WIDTH - 18 + reach, y2: y, major },
		];
	}).flat();

	let grip: HTMLDivElement | undefined = $state();

	function valueAt(fraction: number): number {
		return clamp(1 - ((fraction * HEIGHT - TRAVEL_INSET) / TRAVEL) * 2);
	}

	function onkeydown(event: KeyboardEvent): void {
		const step = KEY_STEPS[event.key];
		if (step === undefined) return;
		event.preventDefault();
		onvalue(clamp(value + step));
	}

	function clamp(next: number): number {
		return Math.min(1, Math.max(-1, next));
	}
</script>

<div class="flex flex-col items-center gap-2">
	<span class="text-fg-default font-mono text-[15px] leading-5 tabular-nums">{format(shown)}</span>
	<div
		class="focus-visible:ring-border-default/50 relative my-3.5 cursor-ns-resize touch-none rounded-md focus-visible:ring-2"
		style:width="{WIDTH}px"
		style:height="{HEIGHT}px"
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin={-100}
		aria-valuemax={100}
		aria-valuenow={Math.round(value * 100)}
		aria-valuetext={format(value)}
		{onkeydown}
		{@attach gaugeDrag({
			onmove: ([, fraction]) => onvalue(valueAt(fraction)),
			ongrab: () => ongrab(),
			onrelease: () => onrelease(),
			handle: () => grip,
		})}
	>
		<span
			class="text-fg-tertiary absolute inset-x-0 -top-[18px] text-center font-mono text-[9.5px] tracking-[0.08em]"
		>
			{top}
		</span>
		<div
			class="absolute top-2 bottom-2 left-1/2 -ml-[3px] w-1.5 rounded-[3px] shadow-xs"
			style:background={rail}
		></div>
		<svg
			class="pointer-events-none absolute inset-0"
			width={WIDTH}
			height={HEIGHT}
			aria-hidden="true"
		>
			<ScaleMarks ticks={TICKS} />
		</svg>
		<div
			bind:this={grip}
			class="bg-button-primary absolute left-1/2 flex h-[18px] w-10 -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center justify-center gap-0.5 rounded-[5px] shadow-md"
			style:top="{TRAVEL_INSET + ((1 - shown) / 2) * TRAVEL}px"
		>
			<span class="bg-status-idle h-px w-5"></span>
			<span class="bg-status-idle h-px w-5"></span>
			<span class="bg-status-idle h-px w-5"></span>
		</div>
		<span
			class="text-fg-tertiary absolute inset-x-0 -bottom-[18px] text-center font-mono text-[9.5px] tracking-[0.08em]"
		>
			{bottom}
		</span>
	</div>
	<span class="text-fg-secondary text-2xs">{label}</span>
</div>
