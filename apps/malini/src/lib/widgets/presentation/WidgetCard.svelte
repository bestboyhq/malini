<script lang="ts">
	import { WIDGET_DEFAULT_SPAN } from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { Strip } from '$hyper-ui/components/strip';
	import { Icon } from '$hyper-ui/icons';
	import { placeWidgetCommand } from '$lib/widgets/application/commands/place-widget.command';
	import { removeWidgetCommand } from '$lib/widgets/application/commands/remove-widget.command';
	import { watchWidgetsHook } from '$lib/widgets/application/hooks/watch-widgets.hook';
	import { widgetBoardQuery } from '$lib/widgets/application/queries/widget-board.query.svelte';
	import { savedWidget } from '$lib/widgets/domain/saved-widget';
	import { WIDGET_GAP, shownSpan } from '$lib/widgets/domain/widget-grid';
	import { sourceLine } from '$lib/widgets/domain/widget-text';
	import { cardGrid } from './board-grids.svelte';
	import WidgetTile from './WidgetTile.svelte';

	interface Props {
		workstreamId: string;
		input: Readonly<Record<string, unknown>>;
		output: string | null;
		status: 'running' | 'completed' | 'failed';
	}

	let { workstreamId, input, output, status }: Props = $props();

	let width = $state(0);

	const saved = $derived(savedWidget(input, output));
	const widgetId = $derived(saved.widget?.id ?? '');
	const board = $derived(widgetBoardQuery.data(workstreamId));
	const widget = $derived(board?.widgets.find(({ id }) => id === widgetId) ?? saved.widget);
	const gone = $derived(
		status === 'completed' && board !== null && !board.widgets.some(({ id }) => id === widgetId),
	);
	const reading = $derived(widgetBoardQuery.reading(workstreamId, widgetId) ?? saved.reading);
	const placement = $derived(board?.placements.find((each) => each.widgetId === widgetId) ?? null);
	const grid = $derived(cardGrid(workstreamId, width));
	const span = $derived(shownSpan(placement?.span ?? WIDGET_DEFAULT_SPAN, grid.columns));
	const blocked = $derived(blockedReason());

	$effect(() => watchWidgetsHook(workstreamId));

	function blockedReason(): string | null {
		if (status === 'running') return 'Saving the widget';
		if (status === 'failed' || widgetId === '') return 'The widget was not saved';
		if (gone) return 'Removed from your board';
		return null;
	}

	function cells(count: number): number {
		return Math.max(0, grid.cell) * count + WIDGET_GAP * (count - 1);
	}
</script>

{#if widget}
	<section
		class="w-full"
		aria-label="{widget.title} widget"
		data-testid="widget-card"
		data-widget-id={widgetId}
	>
		<div class="bg-surface-50 border-surface-50-border rounded-xl border-[0.5px] px-4 pt-4 pb-3">
			<div bind:clientWidth={width}>
				<div style:width="{cells(span.columns)}px" style:height="{cells(span.rows)}px">
					<WidgetTile {widget} {reading} {span} columns={grid.columns} />
				</div>
			</div>
			<p class="text-fg-tertiary text-2xs mt-3 min-w-0 truncate font-mono leading-4">
				{sourceLine(widget)}
			</p>
		</div>
		<Strip>
			{#if blocked !== null}
				<span class="text-fg-tertiary min-w-0 truncate">{blocked}</span>
			{:else if placement}
				<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
					<Icon name="check" size={12} />
					On your board
				</span>
				<Button
					variant="ghost"
					size="sm"
					class="ml-auto"
					onclick={() => removeWidgetCommand(workstreamId, widgetId)}
				>
					Remove
				</Button>
			{:else}
				<span class="text-fg-tertiary min-w-0 truncate">Not on your board</span>
				<Button
					variant="secondary"
					size="sm"
					class="ml-auto"
					onclick={() => placeWidgetCommand(workstreamId, widgetId, 0)}
				>
					Add to your board
				</Button>
			{/if}
		</Strip>
	</section>
{/if}
