<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Playhead } from '$hyper-ui/components/playhead';
	import { Icon } from '$hyper-ui/icons';
	import type { ExplorerItem } from '$lib/jobs/domain/explorer';
	import { count, explorerClock, itemMark } from './explorer-copy';

	interface Props {
		since: number;
		until: number;
		items: readonly ExplorerItem[];
		lit: ReadonlySet<string>;
		at: number | null;
		playing: boolean;
		onseek: (at: number) => void;
		onplay: () => void;
	}

	let { since, until, items, lit, at, playing, onseek, onplay }: Props = $props();

	const BUCKETS = 120;
	const BAR_HEIGHT = 28;
	const HOUR_MS = 60 * 60 * 1_000;

	const span = $derived(Math.max(1, until - since));
	const buckets = $derived(bucketsOf(items));
	const peak = $derived(Math.max(1, ...buckets.map((bucket) => bucket.length)));
	const merges = $derived(items.filter((item) => itemMark(item)?.label === 'merged'));
	const ticks = $derived(ticksOf(since, until));

	function bucketsOf(list: readonly ExplorerItem[]): ExplorerItem[][] {
		const filled: ExplorerItem[][] = Array.from({ length: BUCKETS }, () => []);
		for (const item of list) {
			const index = Math.min(
				BUCKETS - 1,
				Math.max(0, Math.floor(((item.at - since) / span) * BUCKETS)),
			);
			filled[index]?.push(item);
		}
		return filled;
	}

	function ticksOf(from: number, to: number): readonly number[] {
		const length = to - from;
		const step = (length > 12 * HOUR_MS ? 3 : length > 3 * HOUR_MS ? 1 : 0.25) * HOUR_MS;
		const first = Math.ceil(from / step) * step;
		return Array.from(
			{ length: Math.max(0, Math.floor((to - first) / step) + 1) },
			(_, index) => first + index * step,
		);
	}

	function share(time: number): number {
		return Math.min(100, Math.max(0, ((time - since) / span) * 100));
	}

	function barTone(bucket: readonly ExplorerItem[], index: number): string {
		if (bucket.some((item) => lit.has(item.id))) return 'fill-brand-icon';
		if (at !== null && since + (index / BUCKETS) * span <= at) return 'fill-status-idle';
		return 'fill-surface-150-border';
	}
</script>

<div class="flex flex-col gap-2 px-4 pt-3 pb-2" data-testid="explorer-strip">
	<div class="flex items-center gap-3">
		<h2 class="text-fg-default text-xs font-medium">Timeline of events</h2>
		<span class="text-fg-tertiary text-2xs tabular-nums">{count(items.length, 'event')}</span>
		<span class="text-fg-tertiary text-2xs ml-auto flex items-center gap-3">
			<span class="flex items-center gap-1">
				<Icon name="pr-merged" size={12} class="text-merged-content" />
				merged
			</span>
			<span class="flex items-center gap-1.5">
				<span class="bg-brand-icon size-1.5 rounded-full" aria-hidden="true"></span>
				selected chain
			</span>
		</span>
	</div>
	<div class="flex items-center gap-3">
		<Button variant="secondary" size="sm" onclick={onplay}>
			<Icon name={playing ? 'pause' : 'play'} size={12} />
			{playing ? 'Pause' : 'Play'}
		</Button>
		<div class="relative min-w-0 flex-1">
			<div class="relative h-3.5" aria-hidden="true">
				{#each merges as item (item.id)}
					<span class="absolute top-0 -translate-x-1/2" style:left="{share(item.at)}%">
						<Icon name="pr-merged" size={11} class="text-merged-content" />
					</span>
				{/each}
			</div>
			<svg
				class="block w-full"
				height={BAR_HEIGHT}
				viewBox={`0 0 ${BUCKETS} ${BAR_HEIGHT}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{#each buckets as bucket, index (index)}
					{#if bucket.length > 0}
						{@const height = Math.max(2, Math.sqrt(bucket.length / peak) * BAR_HEIGHT)}
						<rect
							x={index + 0.15}
							y={BAR_HEIGHT - height}
							width={0.7}
							{height}
							class={barTone(bucket, index)}
						/>
					{/if}
				{/each}
			</svg>
			<Playhead
				value={(at ?? until) - since}
				max={span}
				step={1_000}
				marker={null}
				label="Time on the timeline"
				onseek={(value) => onseek(since + value)}
			/>
			<div class="relative h-4" aria-hidden="true">
				{#each ticks as tick (tick)}
					<span
						class="text-fg-tertiary text-3xs absolute top-0 -translate-x-1/2 font-mono tabular-nums"
						style:left="{share(tick)}%"
					>
						{explorerClock(tick)}
					</span>
				{/each}
			</div>
		</div>
		<span class="text-fg-tertiary text-2xs w-11 shrink-0 text-right font-mono tabular-nums">
			{explorerClock(at ?? until)}
		</span>
	</div>
</div>
