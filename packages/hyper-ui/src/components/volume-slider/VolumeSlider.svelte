<script lang="ts">
	interface Props {
		value: number;
		label: string;
		oninput: (value: number) => void;
	}

	let { value, label, oninput }: Props = $props();
</script>

<div class="relative flex h-full w-7 justify-center py-2.5">
	<div class="bg-surface-150 relative h-full w-1 rounded-full">
		<div
			class="bg-surface-invert/40 absolute inset-x-0 bottom-0 rounded-full"
			style:height="{value * 100}%"
		></div>
	</div>
	<input
		type="range"
		class="volume absolute inset-x-0 inset-y-1"
		min="0"
		max="1"
		step="0.05"
		{value}
		aria-label={label}
		oninput={(event) => oninput(Number(event.currentTarget.value))}
	/>
</div>

<style>
	.volume {
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
		writing-mode: vertical-lr;
		direction: rtl;
	}

	.volume::-webkit-slider-runnable-track {
		width: 1.75rem;
		background: transparent;
	}

	.volume::-webkit-slider-thumb {
		width: 12px;
		height: 12px;
		margin-left: calc((1.75rem - 12px) / 2);
		border-radius: 9999px;
		appearance: none;
		background: var(--color-surface-elevated);
		box-shadow:
			0 0 0 0.5px var(--color-border-default),
			var(--shadow-sm);
		transition: scale 120ms;
	}

	.volume:hover::-webkit-slider-thumb {
		scale: 1.15;
	}

	.volume:focus-visible {
		outline: none;
	}

	.volume:focus-visible::-webkit-slider-thumb {
		box-shadow:
			0 0 0 2px var(--color-border-default),
			var(--shadow-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.volume::-webkit-slider-thumb {
			transition: none;
		}
	}
</style>
