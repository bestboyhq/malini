<script lang="ts">
	import type { ResourceSample } from '$contract/stats';
	import { RESOURCE_HISTORY_MS } from '$lib/stats/domain/resources';
	import { memoryLine, memorySpanLabel } from './memory-line';

	interface Props {
		samples: readonly ResourceSample[];
	}

	let { samples }: Props = $props();

	const WIDTH = 160;
	const HEIGHT = 36;
	const path = $derived(memoryLine(samples, RESOURCE_HISTORY_MS, WIDTH, HEIGHT));
</script>

<div class="min-w-0" data-testid="stats-memory-chart">
	<div class="relative h-9 w-full">
		{#if path}
			<svg
				class="absolute inset-0 h-full w-full overflow-visible"
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<path d={path.area} class="fill-surface-elevated-selected" stroke="none" />
				<path
					d={path.line}
					class="stroke-activity-4"
					fill="none"
					stroke-width="1.5"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
		{/if}
	</div>
	<p class="text-fg-tertiary truncate text-center text-xs" data-testid="stats-memory-span">
		{path ? memorySpanLabel(path.spanMs) : 'Measuring…'}
	</p>
</div>
