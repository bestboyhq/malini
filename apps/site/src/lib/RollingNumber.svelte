<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';

	let { value }: { value: number } = $props();

	const chars = $derived([...value.toLocaleString('en-US')]);
	const roll = { duration: 220, easing: cubicOut, opacity: 0.2 };
</script>

<span class="number">
	{#each chars as char, index (chars.length - index)}
		<span class="slot">
			{#key char}
				<span class="char" in:fly={{ ...roll, y: '100%' }} out:fly={{ ...roll, y: '-100%' }}>
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
