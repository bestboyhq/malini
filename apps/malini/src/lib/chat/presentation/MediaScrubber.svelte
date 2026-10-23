<script lang="ts">
	interface Props {
		value: number;
		max: number;
		step: number;
		marker: number | null;
		label: string;
		onseek: (value: number) => void;
	}

	let { value, max, step, marker, label, onseek }: Props = $props();
	const SNAP = 0.025;
	const share = (at: number): number => (max > 0 ? (at / max) * 100 : 0);

	function seek(event: Event & { currentTarget: HTMLInputElement }): void {
		const next = Number(event.currentTarget.value);
		onseek(marker !== null && Math.abs(next - marker) < max * SNAP ? marker : next);
	}
</script>

<div class="relative flex h-7 min-w-0 flex-1 items-center">
	<div class="bg-surface-150 relative h-1 w-full rounded-full">
		<div
			class="bg-surface-invert/40 absolute inset-y-0 left-0 rounded-full"
			style:width="{share(value)}%"
		></div>
		{#if marker !== null}
			<span
				class="bg-brand-foreground absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
				style:left="{share(marker)}%"
				data-testid="media-marker"
			></span>
		{/if}
	</div>
	<!-- eslint-disable-next-line @malini/desktop/no-raw-form-control -- a playhead is a range slider; hyper-ui has no slider primitive, and TextInput, Checkbox and Switch cannot seek. -->
	<input
		type="range"
		class="playhead absolute inset-0 h-7 w-full"
		min="0"
		{max}
		{step}
		{value}
		aria-label={label}
		oninput={seek}
	/>
</div>

<style>
	.playhead {
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	.playhead::-webkit-slider-runnable-track {
		height: 1.75rem;
		background: transparent;
	}

	.playhead::-webkit-slider-thumb {
		width: 12px;
		height: 12px;
		margin-top: calc((1.75rem - 12px) / 2);
		border-radius: 9999px;
		appearance: none;
		background: var(--color-surface-elevated);
		box-shadow:
			0 0 0 0.5px var(--color-border-default),
			var(--shadow-sm);
		cursor: grab;
		transition: scale 120ms;
	}

	.playhead:hover::-webkit-slider-thumb {
		scale: 1.15;
	}

	.playhead:active::-webkit-slider-thumb {
		cursor: grabbing;
	}

	.playhead:focus-visible {
		outline: none;
	}

	.playhead:focus-visible::-webkit-slider-thumb {
		box-shadow:
			0 0 0 2px var(--color-border-default),
			var(--shadow-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.playhead::-webkit-slider-thumb {
			transition: none;
		}
	}
</style>
