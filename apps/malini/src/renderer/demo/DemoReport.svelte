<script lang="ts">
	import { parseTurnReport, type TurnVariant } from '$lib/chat/domain/turn-report';
	import type { VariantPick } from '$lib/chat/domain/variant-pick';
	import TurnReportCard from '$lib/chat/presentation/TurnReportCard.svelte';
	import { workstreamOf } from './demo-data';
	import { demoMediaUrl } from './demo-media';

	const CARD_WIDTH = 640;

	let { workstreamId }: { workstreamId: string } = $props();

	const turns = $derived(
		(workstreamOf(workstreamId)?.runs ?? []).map((run) => ({
			runId: run.id,
			report: parseTurnReport(run.report),
		})),
	);
	const report = $derived(turns.at(-1)?.report ?? parseTurnReport(''));
	let pick = $state<VariantPick | null>(null);
	let innerWidth = $state(CARD_WIDTH);
	let innerHeight = $state(0);
	let cardHeight = $state(0);
	const scale = $derived(
		Math.min(1, innerWidth / CARD_WIDTH, cardHeight > 0 ? innerHeight / cardHeight : 1),
	);

	function choose(picked: TurnVariant, reason: string): void {
		pick = { picked, options: report.variants, reason };
	}

	function stay(): void {}
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<main class="bg-surface-root relative h-dvh overflow-hidden">
	<div
		class="absolute top-1/2 left-1/2 -translate-1/2 p-4"
		style:width="{CARD_WIDTH}px"
		style:scale
		bind:clientHeight={cardHeight}
	>
		<TurnReportCard
			{report}
			{workstreamId}
			history={turns.slice(0, -1)}
			{pick}
			needsOpen={pick === null}
			imagesrc={demoMediaUrl}
			onpick={choose}
			onsendnext={stay}
			onscratchpad={stay}
		/>
	</div>
</main>
