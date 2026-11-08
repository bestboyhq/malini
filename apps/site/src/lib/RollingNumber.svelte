<script lang="ts">
	import { wheels } from './odometer';

	let { from, rate, elapsed }: { from: number; rate: number; elapsed: number } = $props();

	const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
	const positions = $derived(wheels(from, rate, elapsed));
</script>

<span class="number">
	{#each positions as position, index (positions.length - index)}
		{#if index > 0 && (positions.length - index) % 3 === 0}<span>,</span>{/if}
		<span class="wheel">
			<span class="faces" style:translate="0 {-position}lh">
				{#each FACES as face, slot (slot)}<span>{face}</span>{/each}
			</span>
		</span>
	{/each}
</span>

<style>
	.number {
		display: inline-flex;
		font-variant-numeric: tabular-nums;
	}

	.wheel {
		height: 1lh;
		overflow: hidden;
		mask: linear-gradient(#0000, #000 20% 80%, #0000);
	}

	.faces {
		display: flex;
		flex-direction: column;
	}
</style>
