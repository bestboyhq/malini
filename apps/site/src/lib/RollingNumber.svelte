<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';

	let { value }: { value: number } = $props();

	const chars = $derived([...value.toLocaleString('en-US')]);
	const roll = (_node: Element, y: number): TransitionConfig => ({
		duration: 220,
		easing: cubicOut,
		css: (_t, u) => `translate: 0 ${u * y}%; opacity: ${1 - u * 0.8};`,
	});
</script>

<span class="number">
	{#each chars as char, index (chars.length - index)}
		<span class="slot">
			{#key char}
				<span class="char" in:roll={100} out:roll={-100}>
					{char}
				</span>
			{/key}
		</span>
	{/each}
</span>

<style>
	.number {
		display: inline-flex;
		font-variant-numeric: tabular-nums;
	}

	.slot {
		display: inline-grid;
		overflow: hidden;
		height: 1lh;
	}

	.char {
		grid-area: 1 / 1;
	}
</style>
