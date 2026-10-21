<script lang="ts">
	import { onMount } from 'svelte';
	import { stageLight } from './stage-light';
	import { STAGE_LIGHTING, stageFallback, type StagePreset } from '../domain/stage-lighting';

	type Props = { preset: StagePreset; caster?: HTMLElement | undefined; lit?: boolean };

	let { preset, caster, lit = $bindable(false) }: Props = $props();

	let mounted = $state(false);

	const lighting = $derived(STAGE_LIGHTING[preset]);
	const fallback = $derived(stageFallback(lighting));

	function onReady(ready: boolean): void {
		lit = ready;
	}

	onMount(() => {
		mounted = true;
	});
</script>

<div
	class={['stage', { lit }]}
	style:--stage-spot={fallback.spot}
	style:--stage-spread={fallback.spread}
	style:--stage-floor={fallback.floor}
	style:--stage-floor-from={fallback.floorFrom}
	style:--stage-floor-to={fallback.floorTo}
	aria-hidden="true"
>
	{#if mounted}
		<canvas width="0" height="0" {@attach stageLight(lighting, onReady, caster)}></canvas>
	{/if}
</div>

<style>
	.stage {
		--stage-strength: 0.5;
		--stage-shadow: rgb(24 20 19 / 0.28);
		position: absolute;
		isolation: isolate;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(
				var(--stage-spread) at var(--stage-spot),
				color-mix(in srgb, var(--stage-ink) calc(18.75% * var(--stage-strength)), transparent),
				transparent
			),
			linear-gradient(
				var(--stage-floor),
				var(--surface-root) var(--stage-floor-from),
				color-mix(
						in srgb,
						var(--stage-ink) calc(11.25% * var(--stage-strength)),
						var(--surface-root)
					)
					var(--stage-floor-to)
			);
	}

	:global(:root[data-theme='dark']) .stage {
		--stage-strength: 1;
		--stage-shadow: rgb(0 0 0 / 0.7);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) .stage {
			--stage-strength: 1;
			--stage-shadow: rgb(0 0 0 / 0.7);
		}
	}

	.stage::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
		background-size: 180px 180px;
		mix-blend-mode: soft-light;
		opacity: 0.5;
	}

	.stage.lit {
		background: none;
	}

	.stage.lit::after {
		content: none;
	}

	canvas {
		border-top-color: var(--surface-root);
		color: var(--stage-ink);
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		visibility: hidden;
	}

	.lit canvas {
		visibility: visible;
	}
</style>
