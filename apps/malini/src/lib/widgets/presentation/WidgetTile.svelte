<script lang="ts">
	import type { Snippet } from 'svelte';
	import type {
		WidgetData,
		WidgetDefinition,
		WidgetNeed,
		WidgetReading,
		WidgetRow,
		WidgetScope,
		WidgetSize,
		WidgetSpan,
		WidgetState,
	} from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { glyphs } from '$hyper-ui/icons/glyphs.generated';
	import { shownSpan, spanLook } from '$lib/widgets/domain/widget-grid';
	import { rowShare, widgetLayout } from '$lib/widgets/domain/widget-layout';
	import {
		WIDGET_STATE_NAMES,
		deltaOf,
		needAction,
		runsLabel,
		tileName,
		widgetValue,
	} from '$lib/widgets/domain/widget-text';
	import WidgetChart from './WidgetChart.svelte';

	interface Props {
		widget: WidgetDefinition;
		reading: WidgetReading | null;
		span: WidgetSpan;
		columns: number;
		sample?: WidgetData | null;
		plan?: Snippet<[WidgetSize]> | undefined;
		planHeader?: Snippet | undefined;
		titleHref?: string | undefined;
		author?: Snippet | undefined;
		onopen?: ((url: string) => void) | undefined;
		onneed?: ((need: WidgetNeed) => void) | undefined;
	}

	let {
		widget,
		reading,
		span,
		columns,
		sample = null,
		plan,
		planHeader,
		titleHref,
		author,
		onopen,
		onneed,
	}: Props = $props();

	type Pointer = Readonly<{ x: number; y: number }>;

	const FALLBACK_ICON: IconName = 'layers';

	const SCOPE_MARKS: Readonly<Record<WidgetScope, Readonly<{ icon: IconName; tip: string }>>> = {
		shared: { icon: 'users', tip: 'Shared data. Everyone sees the same numbers' },
		own: { icon: 'lock', tip: 'Your data. Only you see it' },
	};

	const STATE_ICONS: Readonly<Record<Exclude<WidgetState, 'running'>, IconName>> = {
		success: 'check',
		failure: 'close',
		idle: 'circle',
	};

	const STATE_TONES: Readonly<Record<WidgetState, string>> = {
		success: 'text-success-content',
		failure: 'text-error-content',
		running: 'text-fg-secondary',
		idle: 'text-fg-tertiary',
	};

	const RUN_TONES: Readonly<Record<WidgetState, string>> = {
		success: 'bg-success',
		failure: 'bg-error-content',
		running: 'bg-warning-content',
		idle: 'bg-surface-150',
	};

	const DELTA_TONES = {
		up: 'text-success-content',
		down: 'text-error-content',
	} as const;

	const DELTA_ARROWS = { up: '↑', down: '↓' } as const;

	const HOT_SHARE = 85;

	let pointer = $state<Pointer | null>(null);

	const data = $derived(reading?.data ?? sample);
	const shown = $derived(shownSpan(span, columns));
	const size = $derived(spanLook(shown));
	const wide = $derived(shown.columns > 1);
	const tall = $derived(shown.rows > 1);
	const layout = $derived(widgetLayout(data, shown));
	const need = $derived(reading !== null && !reading.reading ? reading.need : null);
	const stale = $derived(reading !== null && reading.error !== null && reading.data !== null);
	const tileUrl = $derived(data?.url ?? widget.url);
	const scope = $derived(SCOPE_MARKS[widget.scope]);
	const empty = $derived(
		layout.headline === null && layout.rows === null && !layout.caption && !layout.chart,
	);
	const delta = $derived(data?.delta ? deltaOf(data.delta) : null);
	const barValueChars = $derived(
		Math.max(0, ...(data?.rows ?? []).map((row) => barValue(row).length)),
	);
	const rowColumns = $derived(
		layout.rows === 'bars'
			? 'grid-cols-[minmax(0,4.25rem)_minmax(0,1fr)_auto] @max-[11rem]:grid-cols-[minmax(0,1fr)_auto]'
			: 'grid-cols-[minmax(0,1fr)_auto]',
	);

	function iconOf(name: string | null): IconName {
		return name !== null && isIconName(name) ? name : FALLBACK_ICON;
	}

	function isIconName(name: string): name is IconName {
		return Object.hasOwn(glyphs, name);
	}

	function open(url: string): void {
		onopen?.(url);
	}

	function barTone(row: WidgetRow): string {
		if (row.state === 'failure') return 'bg-error-content';
		return (rowShare(row) ?? 0) >= HOT_SHARE ? 'bg-warning-content' : 'bg-status-idle';
	}

	function barValue(row: WidgetRow): string {
		return `${row.value === null ? '' : widgetValue(row.value)} /${row.max === null ? '' : widgetValue(row.max)}`;
	}

	function chartLabel(): string {
		const names = data?.chart?.series.flatMap((series) => series.label ?? []) ?? [];
		const kind = data?.chart?.kind === 'bar' ? 'Bar chart' : 'Line chart';
		return names.length === 0 ? kind : `${kind} of ${names.join(', ')}`;
	}

	function onPointerMove(event: PointerEvent): void {
		pointer = { x: event.clientX, y: event.clientY };
	}

	function onPointerLeave(): void {
		pointer = null;
	}
</script>

{#snippet stateMark(state: WidgetState, markSize: number)}
	{#if state === 'running'}
		<BusyIcon size={markSize} ariaLabel={WIDGET_STATE_NAMES.running} class="shrink-0" />
	{:else}
		<Icon
			name={STATE_ICONS[state]}
			size={markSize}
			ariaLabel={WIDGET_STATE_NAMES[state]}
			class={['shrink-0', STATE_TONES[state]]}
		/>
	{/if}
{/snippet}

{#snippet note()}
	{#if delta || (layout.caption && data?.caption)}
		<p class="text-fg-tertiary text-2xs mt-1.5 flex min-w-0 items-baseline gap-x-1.5 leading-4">
			{#if delta}
				<span
					class={[
						'shrink-0 font-medium whitespace-nowrap tabular-nums',
						delta.direction === null ? 'text-fg-secondary' : DELTA_TONES[delta.direction],
					]}
				>
					{#if delta.direction}{DELTA_ARROWS[delta.direction]}{/if}{delta.text}
				</span>
			{/if}
			{#if layout.caption && data?.caption}
				<span class={['min-w-0', tall ? 'line-clamp-3' : 'truncate']}>{data.caption}</span>
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet number(value: number | string)}
	<p
		class={[
			'text-fg-agent-message-strong flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-1.5 leading-none font-medium tracking-tight tabular-nums',
			layout.hero
				? 'text-[clamp(1.75rem,24cqmin,4.5rem)]'
				: 'text-[clamp(1.375rem,17cqmin,2.25rem)]',
		]}
	>
		<span class="min-w-0 truncate">{widgetValue(value)}</span>
		{#if data?.unit}
			<span
				class="text-fg-tertiary max-w-full truncate text-[max(0.75rem,0.3em)] font-normal tracking-normal"
			>
				{data.unit}
			</span>
		{/if}
	</p>
{/snippet}

{#snippet ring(percent: number, scaled: boolean)}
	<svg
		viewBox="0 0 52 52"
		class={['shrink-0', scaled ? 'size-[clamp(3.25rem,30cqmin,7.5rem)]' : 'size-13']}
		role="img"
		aria-label="{Math.round(percent)}%"
	>
		<circle cx="26" cy="26" r="22" fill="none" stroke-width="6" class="stroke-surface-100" />
		<circle
			cx="26"
			cy="26"
			r="22"
			fill="none"
			stroke-width="6"
			stroke-linecap="round"
			stroke="currentColor"
			pathLength="100"
			stroke-dasharray="{percent} 100"
			transform="rotate(-90 26 26)"
			class="text-fg-secondary"
		/>
		<text
			x="26"
			y="26"
			text-anchor="middle"
			dominant-baseline="central"
			class="text-fg-agent-message-strong fill-current font-mono text-[12px] font-medium"
		>
			{Math.round(percent)}%
		</text>
	</svg>
{/snippet}

{#snippet headline(source: WidgetData, beside: boolean)}
	{#if layout.headline === 'number' && source.value !== null}
		{@render number(source.value)}
		{@render note()}
	{:else if layout.headline === 'ring' && source.percent !== null}
		{#if beside}
			{@render ring(source.percent, false)}
			{#if layout.caption}
				<p class="text-fg-tertiary text-2xs mt-1.5 truncate leading-4">{source.caption}</p>
			{/if}
		{:else}
			<div class={['flex min-w-0', wide ? 'items-center gap-3.5' : 'flex-col items-start gap-2']}>
				{@render ring(source.percent, true)}
				{#if layout.caption}
					<p class="text-fg-tertiary text-2xs line-clamp-2 min-w-0 leading-4">{source.caption}</p>
				{/if}
			</div>
		{/if}
	{:else if layout.headline === 'status' && layout.status !== null}
		<div class={['flex min-w-0', wide ? 'items-center gap-2.5' : 'flex-col items-start']}>
			{@render stateMark(layout.status, tall ? 26 : 22)}
			{#if layout.caption}
				<p
					class={[
						'text-fg-tertiary text-2xs line-clamp-2 min-w-0 leading-4',
						wide ? 'text-xs' : 'mt-1.5',
					]}
				>
					{source.caption}
				</p>
			{/if}
		</div>
	{:else if layout.caption}
		<p class="text-fg-secondary line-clamp-3 text-xs leading-[18px]">{source.caption}</p>
	{/if}
{/snippet}

{#snippet rowBody(row: WidgetRow)}
	{#if layout.rows === 'bars'}
		<span class="text-fg-secondary min-w-0 truncate text-left">{row.label}</span>
		<span
			class="bg-surface-100 relative h-1.5 min-w-0 overflow-hidden rounded-full @max-[11rem]:hidden"
		>
			<span
				class={['absolute inset-y-0 left-0 rounded-full', barTone(row)]}
				style:width="{rowShare(row) ?? 0}%"
			></span>
		</span>
		<span
			class="text-fg-secondary text-right font-mono tabular-nums"
			style:min-width="{barValueChars}ch"
		>
			{row.value === null ? '' : widgetValue(row.value)}
			<span class="text-fg-tertiary">/{row.max === null ? '' : widgetValue(row.max)}</span>
		</span>
	{:else}
		<span class="flex min-w-0 items-center gap-1.5">
			{#if row.state}
				{@render stateMark(row.state, 12)}
			{/if}
			<span class="text-fg-default min-w-0 truncate text-left">{row.label}</span>
			{#if row.detail}
				<span class="text-fg-tertiary max-w-1/2 shrink-0 truncate @max-[11rem]:hidden">
					{row.detail}
				</span>
			{/if}
		</span>
		<span class="text-fg-secondary text-right font-mono tabular-nums">
			{row.value === null ? '' : widgetValue(row.value)}
		</span>
	{/if}
{/snippet}

{#snippet rowList(source: WidgetData, flush: boolean)}
	<ul
		class={[
			'text-2xs grid min-h-0 flex-1 grid-flow-col grid-rows-[repeat(auto-fill,22px)] gap-x-4 overflow-hidden',
			layout.rowColumns === 2
				? 'auto-cols-[minmax(calc(50%-0.5rem),1fr)]'
				: 'auto-cols-[minmax(100%,1fr)]',
			!flush && 'mt-3',
		]}
	>
		{#each source.rows as row, index (index)}
			<li class="min-w-0">
				{#if row.url && onopen}
					{@const url = row.url}
					<Button
						bare
						class={[
							'hover:bg-surface-100 focus-visible:ring-border-default/50 pointer-events-auto -mx-1.5 grid h-[22px] w-[calc(100%+0.75rem)] cursor-pointer items-center gap-2.5 rounded-md px-1.5 outline-0 focus-visible:ring-2',
							rowColumns,
						]}
						onclick={() => open(url)}
					>
						{@render rowBody(row)}
					</Button>
				{:else}
					<div class={['grid h-[22px] items-center gap-2.5', rowColumns]}>
						{@render rowBody(row)}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet detail(source: WidgetData, flush: boolean)}
	{#if layout.chart && source.chart}
		<div class={['flex min-h-0 min-w-0 flex-1', !flush && 'mt-2.5']}>
			<WidgetChart chart={source.chart} label={chartLabel()} {pointer} legend={layout.legend} />
		</div>
	{:else if layout.rows !== null}
		{@render rowList(source, flush)}
	{/if}
{/snippet}

{#snippet needState(wanted: WidgetNeed)}
	{@const action = needAction(widget, wanted)}
	<p class="text-fg-tertiary text-2xs line-clamp-2 leading-4 break-words">{reading?.error}</p>
	{#if action && onneed}
		<span class="pointer-events-auto mt-2 flex" data-widget-chrome>
			<Button variant="secondary" size="xs" onclick={() => onneed?.(wanted)}>{action}</Button>
		</span>
	{/if}
{/snippet}

{#snippet emptyState()}
	<p class="text-fg-tertiary text-2xs flex items-center gap-1.5 leading-4">
		{#if reading?.reading}
			<BusyIcon size={12} />Reading
		{:else if reading?.error}
			Read failed
		{:else}
			Not read yet
		{/if}
	</p>
	{#if reading?.error && !reading.reading && size !== 'small'}
		<p class="text-fg-quaternary text-2xs mt-1 line-clamp-2 leading-4 break-words">
			{reading.error}
		</p>
	{/if}
{/snippet}

<article
	class="bg-surface-root border-border-default/60 hover:border-border-default [container-type:size] relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border-[0.5px] px-3.5 py-3 transition-[border-color] duration-200 select-none"
	aria-label={tileName(widget, span, columns)}
	data-widget-id={widget.id}
	onpointermove={layout.chart ? onPointerMove : undefined}
	onpointerleave={layout.chart ? onPointerLeave : undefined}
>
	{#if tileUrl && onopen}
		<Button
			bare
			class="focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-2xl outline-0 focus-visible:ring-2"
			ariaLabel="Open {widget.title}"
			onclick={() => open(tileUrl)}
		/>
	{/if}

	<header
		class="text-fg-tertiary text-2xs pointer-events-none relative mb-2 flex h-4 shrink-0 items-center gap-1.5"
	>
		<Icon name={iconOf(widget.icon)} size={12} class="shrink-0" />
		<span class="min-w-0 flex-1 truncate">
			{#if titleHref}
				<a
					href={titleHref}
					class="hover:text-fg-default focus-visible:text-fg-default pointer-events-auto underline-offset-2 outline-none hover:underline focus-visible:underline"
					draggable="false"
				>
					{widget.title}
				</a>
			{:else}
				{widget.title}
			{/if}
		</span>
		{#if widget.source.kind === 'plan' && planHeader}
			<span class="pointer-events-auto mr-1 flex min-w-0 items-center" data-widget-chrome>
				{@render planHeader()}
			</span>
		{/if}
		<span class="pointer-events-auto flex shrink-0 items-center gap-1.5">
			{#if reading?.reading}
				<span class="relative flex size-1.5" role="img" aria-label="Reading">
					<span
						class="bg-success-content absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none"
					></span>
					<span class="bg-success-content relative size-1.5 rounded-full"></span>
				</span>
			{:else if stale && need === null && reading?.error}
				<Tooltip content={reading.error} placement="top" class="shrink-0">
					<Icon
						name="warning"
						size={12}
						class="text-warning-content"
						ariaLabel="Last read failed: {reading.error}"
					/>
				</Tooltip>
			{/if}
			{@render author?.()}
			<Tooltip content={scope.tip} placement="top" class="shrink-0">
				<Icon name={scope.icon} size={12} ariaLabel={scope.tip} />
			</Tooltip>
		</span>
	</header>

	<div
		class={[
			'pointer-events-none relative flex min-h-0 flex-1 flex-col',
			layout.chart || layout.rows !== null ? 'justify-start' : 'justify-end',
			stale && need === null && 'opacity-50',
		]}
	>
		{#if widget.source.kind === 'plan'}
			<div class="pointer-events-auto flex min-h-0 flex-1 flex-col">
				{#if plan}
					{@render plan(size)}
				{:else}
					{@render emptyState()}
				{/if}
			</div>
		{:else if need !== null}
			{@render needState(need)}
		{:else if empty || data === null}
			{@render emptyState()}
		{:else if layout.side}
			<div class="flex min-h-0 flex-1 gap-4">
				<div class="flex max-w-[48%] min-w-0 shrink-0 flex-col justify-end">
					{@render headline(data, true)}
				</div>
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					{@render detail(data, true)}
				</div>
			</div>
		{:else}
			{#if layout.headline !== null || layout.caption}
				<div class="shrink-0">
					{@render headline(data, false)}
				</div>
			{/if}
			{@render detail(data, layout.headline === null && !layout.caption)}
		{/if}

		{#if layout.runs.length > 0 && widget.source.kind !== 'plan' && !empty}
			<div class={['flex shrink-0 flex-col gap-1.5', tall ? 'mt-auto pt-3' : 'mt-2.5']}>
				<div
					class={['flex gap-[3px]', tall ? 'h-[clamp(0.875rem,10cqh,2.5rem)]' : 'h-3.5']}
					role="img"
					aria-label={runsLabel(layout.runs)}
				>
					{#each layout.runs as run, index (index)}
						<span class={['h-full max-w-4 min-w-0 flex-1 rounded-[3px]', RUN_TONES[run]]}></span>
					{/each}
				</div>
				{#if tall}
					<p class="text-fg-tertiary text-2xs leading-4" aria-hidden="true">
						{runsLabel(layout.runs)}
					</p>
				{/if}
			</div>
		{/if}
	</div>
</article>
