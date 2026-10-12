<script lang="ts">
	import { untrack } from 'svelte';
	import type { Appearance } from '$lib/app/domain/appearance';
	import {
		nudgedTint,
		tintAtWheel,
		wheelColorAt,
		wheelPointOf,
		type GaugePoint,
		type Tint,
	} from '$lib/app/domain/tint-gauges';
	import GaugeCard from './GaugeCard.svelte';
	import Instrument from './Instrument.svelte';
	import ScaleMarks from './ScaleMarks.svelte';
	import { chromaLabel, degreesLabel } from './gauge-format';
	import { GaugeNeedle, gaugeStatus } from './gauge-needle.svelte';
	import type { ScaleLabel, ScaleTick } from './gauge-scale';

	interface Props {
		appearance: Appearance;
		driving: boolean;
		ontune: (tint: Tint) => void;
	}

	let { appearance, driving, ontune }: Props = $props();

	const SIZE = 236;
	const INSET = 22;
	const CENTER = SIZE / 2;
	const RADIUS = CENTER - INSET;
	const TICKS: readonly ScaleTick[] = Array.from({ length: 36 }, (_, index) => {
		const angle = index * 10;
		const major = angle % 30 === 0;
		return { ...radial(angle, RADIUS + 3, RADIUS + (major ? 9 : 6)), major };
	});
	const LABELS: readonly ScaleLabel[] = [
		label('WARM', 65),
		label('SAGE', 145),
		label('COOL', 250),
		label('ROSE', 345),
	];

	const needle = new GaugeNeedle(untrack(() => wheelPointOf(appearance)));
	let grabbing = $state(false);
	const point: GaugePoint = $derived([needle.at(0), needle.at(1)]);
	const shown = $derived(tintAtWheel(point));
	const neutral = $derived(!shown.chroma);

	$effect(() => needle.moveTo(wheelPointOf(appearance), driving));

	function describeTint(at: GaugePoint): string {
		const { hue = 0, chroma = 0 } = tintAtWheel(at);
		return chroma ? `Hue ${degreesLabel(hue)}, chroma ${chromaLabel(chroma)}` : 'Neutral';
	}

	function radial(angle: number, from: number, to: number): Omit<ScaleTick, 'major'> {
		const start = polar(angle, from);
		const end = polar(angle, to);
		return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
	}

	function label(text: string, angle: number): ScaleLabel {
		return { text, ...polar(angle, RADIUS + 17), anchor: 'middle' };
	}

	function polar(angle: number, distance: number): { x: number; y: number } {
		const radians = (angle * Math.PI) / 180;
		return { x: CENTER + distance * Math.cos(radians), y: CENTER - distance * Math.sin(radians) };
	}
</script>

<GaugeCard title="Tint wheel" status={gaugeStatus(grabbing, needle.following)}>
	{#snippet readout()}
		{#if neutral}
			<span class="text-fg-default">neutral</span>
		{:else}
			<span class="text-fg-default">{degreesLabel(shown.hue ?? 0)}</span>
			<span>{chromaLabel(shown.chroma ?? 0)}</span>
		{/if}
	{/snippet}
	<Instrument
		label="Tint wheel"
		describe={describeTint}
		width={SIZE}
		height={SIZE}
		inset={INSET}
		{point}
		value={wheelPointOf(appearance)}
		colorAt={wheelColorAt}
		onmove={(at) => ontune(tintAtWheel(at))}
		onnudge={(right, up) => ontune(nudgedTint(appearance, -right, up))}
		onreset={() => ontune({ chroma: 0 })}
		ongrab={() => (grabbing = true)}
		onrelease={() => (grabbing = false)}
	>
		{#snippet scale()}
			<ScaleMarks ticks={TICKS} labels={LABELS} />
			<g class="text-fg-secondary fill-none stroke-current" opacity="0.5">
				<circle cx={CENTER} cy={CENTER} r={RADIUS / 2} stroke-dasharray="2 4" />
				<line x1={CENTER - 5} y1={CENTER} x2={CENTER + 5} y2={CENTER} />
				<line x1={CENTER} y1={CENTER - 5} x2={CENTER} y2={CENTER + 5} />
			</g>
		{/snippet}
	</Instrument>
</GaugeCard>
