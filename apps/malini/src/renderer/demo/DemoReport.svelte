<script lang="ts">
	import { BusyIcon } from '$hyper-ui/icons';
	import { parseTurnReport, type TurnVariant } from '$lib/chat/domain/turn-report';
	import type { VariantPick } from '$lib/chat/domain/variant-pick';
	import ToolCard from '$lib/chat/presentation/ToolCard.svelte';
	import TurnReportCard from '$lib/chat/presentation/TurnReportCard.svelte';
	import { reportedWorkstream, toolInput } from './demo-data';
	import { cycleTabs, sweepWipe, whileWatched, type DemoPlay } from './demo-attract';
	import { demoMediaUrl } from './demo-media';

	const CARD_WIDTH = 640;
	const TOOL_MS = 750;

	let { workstreamId, play }: { workstreamId: string; play: DemoPlay | null } = $props();

	const run = $derived(reportedWorkstream(workstreamId)?.runs.at(-1));
	const report = $derived(parseTurnReport(run?.report ?? ''));
	let pick = $state<VariantPick | null>(null);
	let innerWidth = $state(CARD_WIDTH);
	let innerHeight = $state(0);
	let cardHeight = $state(0);
	let shownTools = $state(0);
	let reported = $state(false);
	let elapsedMs = $state(0);
	let stage = $state<HTMLElement>();
	const working = $derived(play === 'work' && run !== undefined);
	const settled = $derived(!working || reported);
	const scale = $derived(
		Math.min(1, innerWidth / CARD_WIDTH, cardHeight > 0 ? innerHeight / cardHeight : 1),
	);

	$effect(() => {
		const view = stage;
		if (!view || (play !== 'sweep' && play !== 'cycle')) return;
		return whileWatched(view, () => (play === 'sweep' ? sweepWipe(view) : cycleTabs(view)), true);
	});

	$effect(() => {
		const view = stage;
		if (play !== 'work' || !view) return;
		return whileWatched(view, replay, false);
	});

	function replay(): () => void {
		const timers: ReturnType<typeof setTimeout>[] = [];
		const started = performance.now();
		const clock = setInterval(() => (elapsedMs = performance.now() - started), 100);
		const count = run?.tools.length ?? 0;
		shownTools = 0;
		elapsedMs = 0;
		reported = false;
		for (let index = 1; index <= count; index++) {
			timers.push(setTimeout(() => (shownTools = index), 500 + index * TOOL_MS));
		}
		timers.push(
			setTimeout(
				() => {
					clearInterval(clock);
					reported = true;
				},
				500 + (count + 1) * TOOL_MS + 400,
			),
		);
		return () => {
			timers.forEach(clearTimeout);
			clearInterval(clock);
		};
	}

	function choose(picked: TurnVariant, reason: string): void {
		pick = { picked, options: report.variants, reason };
	}

	function stay(): void {}
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<main class="bg-surface-root relative h-dvh overflow-hidden" bind:this={stage}>
	<div
		class="absolute top-1/2 left-1/2 flex -translate-1/2 flex-col gap-3 p-4"
		style:width="{CARD_WIDTH}px"
		style:scale
		bind:clientHeight={cardHeight}
	>
		{#if working && run}
			<p
				class="bg-surface-composer border-surface-150-border/60 text-fg-default rounded-xl border px-3 py-2.5 text-sm leading-relaxed"
			>
				{run.prompt}
			</p>
		{/if}
		<div class="grid">
			{#if working && run}
				<div
					class={[
						'col-start-1 row-start-1 flex flex-col gap-0.5 transition-[opacity,translate] duration-300',
						reported && 'pointer-events-none -translate-y-1 opacity-0',
					]}
					aria-hidden={reported}
				>
					{#each run.tools.slice(0, shownTools) as tool, index (index)}
						<ToolCard
							{workstreamId}
							name={tool.name}
							status={index === shownTools - 1 && !reported ? 'running' : 'completed'}
							durationMs={null}
							input={toolInput(workstreamId, tool)}
							output={tool.output ?? 'ok'}
						/>
					{/each}
					<div class="text-fg-tertiary flex min-h-6 items-center gap-2 font-mono text-xs">
						<BusyIcon size={12} />
						<span class="tabular-nums">{(elapsedMs / 1000).toFixed(1)}s</span>
					</div>
				</div>
			{/if}
			<div
				class={[
					'col-start-1 row-start-1 transition-[opacity,translate] duration-500',
					!settled && 'pointer-events-none translate-y-2 opacity-0',
				]}
				aria-hidden={!settled}
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
		</div>
	</div>
</main>
