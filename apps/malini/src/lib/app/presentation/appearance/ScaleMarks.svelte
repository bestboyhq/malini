<script lang="ts">
	import type { ScaleLabel, ScaleTick } from './gauge-scale';

	interface Props {
		ticks: readonly ScaleTick[];
		labels?: readonly ScaleLabel[];
	}

	let { ticks, labels = [] }: Props = $props();
</script>

{#each ticks as tick, index (index)}
	<line
		class={tick.major ? 'text-fg-tertiary stroke-current' : 'stroke-border-default'}
		x1={tick.x1}
		y1={tick.y1}
		x2={tick.x2}
		y2={tick.y2}
	/>
{/each}
{#each labels as label (label.text)}
	<text
		class="text-fg-tertiary fill-current font-mono text-[9.5px] tracking-[0.08em]"
		x={label.x}
		y={label.y}
		text-anchor={label.anchor}
		dominant-baseline="middle"
	>
		{label.text}
	</text>
{/each}
