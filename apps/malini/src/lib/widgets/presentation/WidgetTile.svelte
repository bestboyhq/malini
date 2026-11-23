<script lang="ts">
	import type { Snippet } from 'svelte';
	import type {
		WidgetData,
		WidgetDefinition,
		WidgetReading,
		WidgetRow,
		WidgetScope,
		WidgetSize,
		WidgetState,
	} from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { glyphs } from '$hyper-ui/icons/glyphs.generated';
	import { rowShare, widgetLayout } from '$lib/widgets/domain/widget-layout';
	import {
		WIDGET_STATE_NAMES,
		runsLabel,
		tileName,
		widgetValue,
	} from '$lib/widgets/domain/widget-text';

	interface Props {
		widget: WidgetDefinition;
		reading: WidgetReading | null;
		size: WidgetSize;
		faded?: boolean;
		sample?: WidgetData | null;
		approved?: boolean;
		plan?: Snippet<[WidgetSize]> | undefined;
		planHeader?: Snippet | undefined;
		titleHref?: string | undefined;
		author?: Snippet | undefined;
		actions?: Snippet | undefined;
		onopen?: ((url: string) => void) | undefined;
	}

	let {
		widget,
		reading,
		size,
		faded = false,
		sample = null,
		approved = true,
		plan,
		planHeader,
		titleHref,
		author,
		actions,
		onopen,
	}: Props = $props();

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

	const HOT_SHARE = 85;

	const data = $derived(reading?.data ?? sample);
	const layout = $derived(widgetLayout(data, size));
	const rows = $derived(data?.rows.slice(0, layout.rowCount) ?? []);
	const stale = $derived(reading !== null && reading.error !== null && reading.data !== null);
	const tileUrl = $derived(data?.url ?? widget.url);
	const scope = $derived(SCOPE_MARKS[widget.scope]);
	const locked = $derived(!approved && widget.source.kind === 'command');
	const empty = $derived(layout.headline === null && layout.rows === null && !layout.caption);
	const smallDelta = $derived(size === 'small' && data !== null && data.delta !== null);
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

{#snippet caption(text: string | null)}
	<p class="text-fg-tertiary text-2xs mt-1.5 line-clamp-2 leading-4">
		{#if text}{text}{/if}
		{#if smallDelta && data?.delta}<span class="text-fg-secondary tabular-nums">
				{data.delta}
			</span>{/if}
	</p>
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
		<span class="text-fg-secondary text-right font-mono tabular-nums">
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
	class={[
		'bg-surface-root [container-type:size] relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border-[0.5px] px-3.5 py-3 transition-[border-color] duration-200 select-none',
		faded
			? 'border-border-default border-dashed'
			: 'border-border-default/60 hover:border-border-default',
	]}
	aria-label={tileName(widget, size)}
	data-widget-id={widget.id}
	data-widget-size={size}
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
		<Icon name={iconOf(widget.icon)} size={12} class={['shrink-0', faded && 'opacity-60']} />
		<span class={['min-w-0 flex-1 truncate', faded && 'opacity-60']}>
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
			size === 'large' ? 'justify-start' : 'justify-end',
			faded ? 'opacity-40' : stale && 'opacity-50',
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
		{:else if locked && widget.source.kind === 'command'}
			<p class="text-fg-tertiary text-2xs leading-4">Runs</p>
			<code
				class="text-fg-secondary text-2xs mt-0.5 line-clamp-3 font-mono leading-4 break-all select-text"
			>
				{widget.source.run}
			</code>
		{:else if empty || data === null}
			{@render emptyState()}
		{:else}
			{#if layout.headline === 'number' && data.value !== null}
				<div class="flex min-w-0 items-end justify-between gap-2">
					<p
						class="text-fg-agent-message-strong min-w-0 truncate text-[clamp(1.5rem,21cqmin,2.5rem)] leading-none font-medium tracking-tight tabular-nums"
					>
						{widgetValue(data.value)}{#if data.unit}<span
								class="text-fg-tertiary ml-1 text-xs font-normal tracking-normal"
							>
								{data.unit}
							</span>{/if}
					</p>
					{#if data.delta && size !== 'small'}
						<span class="text-fg-secondary text-2xs shrink-0 leading-4 tabular-nums">
							{data.delta}
						</span>
					{/if}
				</div>
				{#if layout.caption || smallDelta}
					{@render caption(layout.caption ? data.caption : null)}
				{/if}
			{:else if layout.headline === 'ring' && data.percent !== null}
				<div class={['flex', size === 'medium' ? 'items-center gap-3.5' : 'flex-col items-start']}>
					<svg
						viewBox="0 0 52 52"
						class="size-[52px] shrink-0"
						role="img"
						aria-label="{Math.round(data.percent)}%"
					>
						<circle
							cx="26"
							cy="26"
							r="22"
							fill="none"
							stroke-width="6"
							class="stroke-surface-100"
						/>
						<circle
							cx="26"
							cy="26"
							r="22"
							fill="none"
							stroke-width="6"
							stroke-linecap="round"
							stroke="currentColor"
							pathLength="100"
							stroke-dasharray="{data.percent} 100"
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
							{Math.round(data.percent)}%
						</text>
					</svg>
					{#if layout.caption}
						<p
							class={[
								'text-fg-tertiary text-2xs line-clamp-2 leading-4',
								size !== 'medium' && 'mt-2',
							]}
						>
							{data.caption}
						</p>
					{/if}
				</div>
			{:else if layout.headline === 'status' && layout.status !== null}
				{@render stateMark(layout.status, 22)}
				{#if layout.caption}
					{@render caption(data.caption)}
				{/if}
			{:else if layout.caption}
				<p class="text-fg-secondary line-clamp-3 text-xs leading-[18px]">{data.caption}</p>
			{/if}

			{#if layout.runs.length > 0}
				<div class="mt-2.5 flex shrink-0 gap-[3px]" role="img" aria-label={runsLabel(layout.runs)}>
					{#each layout.runs as run, index (index)}
						<span class={['h-3.5 max-w-[9px] min-w-0 flex-1 rounded-[3px]', RUN_TONES[run]]}></span>
					{/each}
				</div>
			{/if}

			{#if rows.length > 0}
				<ul
					class={[
						'text-2xs flex min-h-0 flex-col flex-wrap content-start gap-x-0 overflow-hidden',
						layout.headline === null ? 'flex-1' : 'mt-3 flex-1',
						size === 'large' ? 'justify-start' : 'justify-end',
					]}
				>
					{#each rows as row, index (index)}
						<li class="w-full shrink-0">
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
			{/if}
		{/if}

		{#if actions}
			<div class="pointer-events-auto mt-2 flex shrink-0 items-center gap-1.5">
				{@render actions()}
			</div>
		{/if}
	</div>
</article>
