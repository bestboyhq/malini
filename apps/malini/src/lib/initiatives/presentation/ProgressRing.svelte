<script lang="ts">
	interface Props {
		done: number;
		total: number;
	}

	let { done, total }: Props = $props();

	const PIE_RADIUS = 2.1;
	const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

	const finished = $derived(total > 0 && done === total);
	const share = $derived(total > 0 ? done / total : 0);
</script>

<svg
	width="16"
	height="16"
	viewBox="0 0 16 16"
	fill="none"
	aria-hidden="true"
	class={['shrink-0', finished ? 'text-merged-content' : 'text-fg-secondary']}
>
	<circle cx="8" cy="8" r="6.75" stroke="currentColor" stroke-width="1.5" />
	{#if finished}
		<path
			d="m5.25 8.25 1.75 1.75 3.75-4"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{:else if share > 0}
		<circle
			cx="8"
			cy="8"
			r={PIE_RADIUS}
			stroke="currentColor"
			stroke-width={PIE_RADIUS * 2}
			stroke-dasharray={`${share * PIE_CIRCUMFERENCE} ${PIE_CIRCUMFERENCE}`}
			transform="rotate(-90 8 8)"
		/>
	{/if}
</svg>
