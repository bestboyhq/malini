<script lang="ts">
	import { parseTurnReport, type TurnVariant } from '$lib/chat/domain/turn-report';
	import { readVariantPick, type VariantPick } from '$lib/chat/domain/variant-pick';
	import TurnReportCard from '$lib/chat/presentation/TurnReportCard.svelte';
	import { reportedWorkstream } from './demo-data';
	import { cycleTabs, sweepWipe, whileWatched, type DemoPlay } from './demo-attract';
	import { demoMediaUrl } from './demo-media';

	const CARD_WIDTH = 640;

	let { workstreamId, play }: { workstreamId: string; play: DemoPlay | null } = $props();

	const runs = $derived(reportedWorkstream(workstreamId)?.runs ?? []);
	const turns = $derived(
		runs.map((run) => ({ runId: run.id, report: parseTurnReport(run.report) })),
	);
	const report = $derived(turns.at(-1)?.report ?? parseTurnReport(''));
	const history = $derived(turns.slice(0, -1).slice(-3));
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

	function pickOf(runId: string): VariantPick | null {
		const index = runs.findIndex((run) => run.id === runId);
		const next = runs[index + 1];
		return next ? readVariantPick(next.prompt, turns[index]?.report.variants ?? []) : null;
	}

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
			{history}
			{pickOf}
			{pick}
			needsOpen={pick === null}
			imagesrc={demoMediaUrl}
			onpick={choose}
			onsendnext={stay}
			onscratchpad={stay}
		/>
	</div>
</main>
