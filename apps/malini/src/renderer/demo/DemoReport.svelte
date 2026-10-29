<script lang="ts">
	import { parseTurnReport, type TurnVariant } from '$lib/chat/domain/turn-report';
	import type { VariantPick } from '$lib/chat/domain/variant-pick';
	import TurnReportCard from '$lib/chat/presentation/TurnReportCard.svelte';
	import { reportedWorkstream } from './demo-data';
	import { cycleTabs, sweepWipe, whileWatched, type DemoPlay } from './demo-attract';
	import { demoMediaUrl } from './demo-media';

	const CARD_WIDTH = 640;

	let { workstreamId, play }: { workstreamId: string; play: DemoPlay | null } = $props();

	const report = $derived(
		parseTurnReport(reportedWorkstream(workstreamId)?.runs.at(-1)?.report ?? ''),
	);
	let pick = $state<VariantPick | null>(null);
	let innerWidth = $state(CARD_WIDTH);
	let innerHeight = $state(0);
	let cardHeight = $state(0);
	let stage = $state<HTMLElement>();
	const scale = $derived(
		Math.min(1, innerWidth / CARD_WIDTH, cardHeight > 0 ? innerHeight / cardHeight : 1),
	);

	$effect(() => {
		const view = stage;
		if (!view || play === null) return;
		return whileWatched(view, () => (play === 'sweep' ? sweepWipe(view) : cycleTabs(view)), true);
	});

	function choose(picked: TurnVariant, reason: string): void {
		pick = { picked, options: report.variants, reason };
	}

	function stay(): void {}
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<main class="bg-surface-root relative h-dvh overflow-hidden" bind:this={stage}>
	<div
		class="absolute top-1/2 left-1/2 -translate-1/2 p-4"
		style:width="{CARD_WIDTH}px"
		style:scale
		bind:clientHeight={cardHeight}
	>
		<TurnReportCard
			{report}
			{workstreamId}
			{pick}
			needsOpen={pick === null}
			imagesrc={demoMediaUrl}
			onpick={choose}
			onsendnext={stay}
			onscratchpad={stay}
		/>
	</div>
</main>
