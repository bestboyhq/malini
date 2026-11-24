<script lang="ts">
	import type { WidgetChart } from '$contract/widgets';
	import {
		areaPath,
		barLayout,
		barPath,
		chartCount,
		chartDetail,
		chartScale,
		chartValues,
		labelIndexes,
		lastValue,
		lineRuns,
		monotonePath,
		pointCount,
		sparkScale,
	} from '$lib/widgets/domain/widget-chart';
	import { widgetValue } from '$lib/widgets/domain/widget-text';

	type Pointer = Readonly<{ x: number; y: number }>;

	type Margin = Readonly<{ top: number; right: number; bottom: number; left: number }>;

	type XLabel = Readonly<{ index: number; text: string; left: number; align: Align }>;

	type Align = 'start' | 'center' | 'end' | 'slot';

	interface Props {
		chart: WidgetChart;
		label: string;
		pointer: Pointer | null;
		legend: boolean;
	}

	let { chart, label, pointer, legend }: Props = $props();

	const TONES = ['text-chart-1', 'text-chart-2', 'text-chart-3'] as const;
	const LINE_TONE = 'text-fg-default';
	const BAR_TONE = 'text-fg-quaternary';
	const ALIGNS: Readonly<Record<Align, string>> = {
		start: '',
		center: '-translate-x-1/2',
		end: '-translate-x-full',
		slot: '-translate-x-1/2 truncate text-center',
	};
	const X_LABEL_EVERY = 110;
	const SLOT_LABEL_MIN = 34;
	const FEW_CATEGORIES = 8;
	const DIGIT_WIDTH = 6.6;
	const TIP_GAP = 12;
	const LABEL_ROOM = 20;

	const id = $props.id();

	let width = $state(0);
	let height = $state(0);
	let tipWidth = $state(0);
	let box = $state<HTMLDivElement>();

	const detail = $derived(chartDetail(width, height));
	const tiny = $derived(detail === 'tiny');
	const bars = $derived(chart.kind === 'bar');
	const count = $derived(pointCount(chart));
	const values = $derived(chartValues(chart));
	const scale = $derived(tiny ? sparkScale(values, bars) : chartScale(values, 4));
	const ticks = $derived(detail === 'large' ? scale.ticks : []);
	const tickLabels = $derived(ticks.map(chartCount));
	const labelled = $derived(!tiny && chart.labels.some((text) => text !== ''));
	const margin = $derived(marginOf());
	const plotLeft = $derived(margin.left);
	const plotRight = $derived(Math.max(plotLeft + 1, width - margin.right));
	const plotTop = $derived(margin.top);
	const plotBottom = $derived(Math.max(plotTop + 1, height - margin.bottom));
	const slot = $derived((plotRight - plotLeft) / Math.max(1, count));
	const base = $derived(scale.low >= 0 ? plotBottom : yAt(0));
	const lines = $derived(
		bars ? [] : chart.series.map((series) => lineRuns(series.values.map(pointAt))),
	);
	const mono = $derived(chart.series.length === 1);
	const area = $derived(mono && !bars);
	const columns = $derived(barLayout(slot, count, chart.series.length));
	const hovered = $derived(hoveredIndex());
	const xLabels = $derived(xLabelsOf());
	const tipLeft = $derived(hovered === null ? 0 : tipLeftAt(xAt(hovered)));

	function marginOf(): Margin {
		if (tiny)
			return bars
				? { top: 1, right: 0, bottom: 0, left: 0 }
				: { top: 3, right: 1, bottom: 3, left: 1 };
		const bottom = labelled ? LABEL_ROOM : 6;
		const left =
			ticks.length > 0 ? Math.max(...tickLabels.map((text) => text.length)) * DIGIT_WIDTH + 10 : 0;
		return bars
			? { top: 6, right: 0, bottom, left }
			: { top: 6, right: 6, bottom, left: left || 6 };
	}

	function xAt(index: number): number {
		if (bars) return plotLeft + slot * (index + 0.5);
		if (count === 1) return (plotLeft + plotRight) / 2;
		return plotLeft + ((plotRight - plotLeft) * index) / (count - 1);
	}

	function yAt(value: number): number {
		const share = (value - scale.low) / (scale.high - scale.low || 1);
		return plotBottom - share * (plotBottom - plotTop);
	}

	function pointAt(value: number | null, index: number): Readonly<{ x: number; y: number }> | null {
		return value === null ? null : { x: xAt(index), y: yAt(value) };
	}

	function hoveredIndex(): number | null {
		if (pointer === null || box === undefined || tiny) return null;
		const bounds = box.getBoundingClientRect();
		const x = pointer.x - bounds.left;
		const y = pointer.y - bounds.top;
		if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return null;
		const index = bars
			? Math.floor((x - plotLeft) / slot)
			: Math.round(((x - plotLeft) / (plotRight - plotLeft)) * (count - 1));
		return Math.min(count - 1, Math.max(0, index));
	}

	function xLabelsOf(): readonly XLabel[] {
		if (!labelled) return [];
		if (bars && slot >= SLOT_LABEL_MIN && (count <= FEW_CATEGORIES || labelsFitSlots())) {
			return chart.labels
				.slice(0, count)
				.map((text, index) => ({ index, text, left: xAt(index), align: 'slot' }));
		}
		const slots =
			detail === 'large' ? Math.min(7, Math.max(2, Math.floor(width / X_LABEL_EVERY))) : 2;
		const indexes = labelIndexes(count, slots);
		return indexes.flatMap<XLabel>((index, order) => {
			const text = chart.labels[index] ?? '';
			if (text === '') return [];
			const edge = indexes.length > 1 && (!bars || text.length * DIGIT_WIDTH > slot);
			if (edge && order === 0) return [{ index, text, left: plotLeft, align: 'start' }];
			if (edge && order === indexes.length - 1)
				return [{ index, text, left: plotRight, align: 'end' }];
			return [{ index, text, left: xAt(index), align: 'center' }];
		});
	}

	function labelsFitSlots(): boolean {
		return Math.max(...chart.labels.map((text) => text.length)) * DIGIT_WIDTH <= slot - 4;
	}

	function tipLeftAt(x: number): number {
		const left = x > width / 2 ? x - TIP_GAP - tipWidth : x + TIP_GAP;
		return Math.max(0, Math.min(width - tipWidth, left));
	}

	function toneOf(order: number): string {
		if (!mono) return TONES[order] ?? LINE_TONE;
		return bars ? BAR_TONE : LINE_TONE;
	}

	function valueText(value: number | null | undefined): string {
		return value === null || value === undefined ? 'None' : widgetValue(value);
	}
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	<div
		class="relative min-h-0 flex-1"
		bind:this={box}
		bind:clientWidth={width}
		bind:clientHeight={height}
	>
		{#if width > 0 && height > 0}
			<svg
				{width}
				{height}
				class="absolute inset-0 block overflow-visible"
				role="img"
				aria-label={label}
			>
				<defs>
					<linearGradient id="{id}-fill" x1="0" x2="0" y1="0" y2="1" class="text-fg-default">
						<stop offset="0%" stop-color="currentColor" stop-opacity="0.16" />
						<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
					</linearGradient>
				</defs>

				{#if bars && hovered !== null}
					<rect
						x={plotLeft + slot * hovered + 1}
						y="0"
						width={Math.max(0, slot - 2)}
						{height}
						rx="6"
						class="fill-surface-50"
					/>
				{/if}

				{#if !tiny}
					{#each ticks.length > 0 ? ticks : [Math.max(0, scale.low)] as tick (tick)}
						<line
							x1={ticks.length > 0 ? plotLeft - 4 : plotLeft}
							x2={plotRight}
							y1={yAt(tick)}
							y2={yAt(tick)}
							class="stroke-surface-50-border"
							stroke-dasharray={tick === 0 ? undefined : '3 4'}
							shape-rendering="crispEdges"
						/>
					{/each}
				{/if}

				{#if bars}
					{#each chart.series as series, order (order)}
						{#each series.values as value, index (index)}
							{#if value !== null}
								<path
									d={barPath(
										xAt(index) + (columns.offsets[order] ?? 0),
										yAt(Math.max(0, value)),
										yAt(Math.min(0, value)),
										columns.width,
									)}
									fill="currentColor"
									class={[toneOf(order), mono && hovered === index && 'fill-surface-invert']}
								/>
							{/if}
						{/each}
					{/each}
				{:else}
					{#each lines as runs, order (order)}
						{#if area}
							{#each runs as run, index (index)}
								<path d={areaPath(run, base)} fill="url(#{id}-fill)" />
							{/each}
						{/if}
						{#each runs as run, index (index)}
							{#if run.length === 1 && run[0]}
								<circle
									cx={run[0].x}
									cy={run[0].y}
									r="2"
									fill="currentColor"
									class={toneOf(order)}
								/>
							{:else}
								<path
									d={monotonePath(run)}
									fill="none"
									stroke="currentColor"
									class={toneOf(order)}
									stroke-width={tiny ? 1.5 : 2}
									stroke-linejoin="round"
									stroke-linecap="round"
								/>
							{/if}
						{/each}
					{/each}

					{#if hovered !== null}
						{@const index = hovered}
						<line
							x1={xAt(index)}
							x2={xAt(index)}
							y1={plotTop}
							y2={plotBottom}
							class="stroke-border-default"
							shape-rendering="crispEdges"
						/>
						{#each chart.series as series, order (order)}
							{@const value = series.values[index]}
							{#if value !== null && value !== undefined}
								<circle
									cx={xAt(index)}
									cy={yAt(value)}
									r="4"
									stroke-width="2"
									fill="currentColor"
									class={[toneOf(order), 'stroke-surface-root']}
								/>
							{/if}
						{/each}
					{/if}
				{/if}
			</svg>

			{#each ticks as tick, index (tick)}
				<span
					class="text-fg-tertiary text-3xs pointer-events-none absolute left-0 -translate-y-1/2 text-right leading-none tabular-nums"
					style:top="{yAt(tick)}px"
					style:width="{plotLeft - 10}px"
					aria-hidden="true"
				>
					{tickLabels[index]}
				</span>
			{/each}

			{#each xLabels as xLabel (xLabel.index)}
				<span
					class={[
						'text-3xs pointer-events-none absolute bottom-0 leading-[14px] whitespace-nowrap tabular-nums',
						ALIGNS[xLabel.align],
						hovered === xLabel.index ? 'text-fg-default' : 'text-fg-tertiary',
					]}
					style:left="{xLabel.left}px"
					style:max-width={xLabel.align === 'slot' ? `${slot - 4}px` : undefined}
					aria-hidden="true"
				>
					{xLabel.text}
				</span>
			{/each}

			{#if hovered !== null}
				{@const index = hovered}
				<div
					class="bg-surface-elevated border-surface-elevated-border text-2xs pointer-events-none absolute z-10 max-w-full min-w-28 rounded-xl border px-2.5 py-1.5 leading-4 whitespace-nowrap shadow-lg"
					style:left="{tipLeft}px"
					style:top="{plotTop}px"
					bind:clientWidth={tipWidth}
					aria-hidden="true"
				>
					{#if chart.labels[index]}
						<p class="text-fg-tertiary truncate">{chart.labels[index]}</p>
					{/if}
					{#each chart.series as series, order (order)}
						<p class="mt-0.5 flex items-center justify-between gap-3">
							<span class="flex min-w-0 items-center gap-1.5">
								<span class={['size-2 shrink-0 rounded-full bg-current', toneOf(order)]}></span>
								{#if series.label}
									<span class="text-fg-secondary truncate">{series.label}</span>
								{/if}
							</span>
							<span class="text-fg-default font-medium tabular-nums">
								{valueText(series.values[index])}
							</span>
						</p>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	{#if legend}
		<ul class="text-2xs mt-2 flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 leading-4">
			{#each chart.series as series, order (order)}
				<li class="flex min-w-0 items-center gap-1.5">
					<span class={['size-2 shrink-0 rounded-full bg-current', toneOf(order)]}></span>
					<span class="text-fg-tertiary truncate">{series.label ?? `Series ${order + 1}`}</span>
					<span class="text-fg-secondary tabular-nums">{valueText(lastValue(series))}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
