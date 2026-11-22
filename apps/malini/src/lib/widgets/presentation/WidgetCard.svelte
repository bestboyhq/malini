<script lang="ts">
	import { WIDGET_DRAG_TYPE, type WidgetSize } from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { Strip } from '$hyper-ui/components/strip';
	import { Icon } from '$hyper-ui/icons';
	import { placeWidgetCommand } from '$lib/widgets/application/commands/place-widget.command';
	import { removeWidgetCommand } from '$lib/widgets/application/commands/remove-widget.command';
	import { resizeWidgetCommand } from '$lib/widgets/application/commands/resize-widget.command';
	import { watchWidgetsHook } from '$lib/widgets/application/hooks/watch-widgets.hook';
	import { widgetBoardQuery } from '$lib/widgets/application/queries/widget-board.query.svelte';
	import { savedWidget } from '$lib/widgets/domain/saved-widget';
	import { WIDGET_GAP, WIDGET_SPANS } from '$lib/widgets/domain/widget-grid';
	import { gallerySizes } from '$lib/widgets/domain/widget-layout';
	import { WIDGET_SIZE_NAMES, sourceLine } from '$lib/widgets/domain/widget-text';
	import WidgetTile from './WidgetTile.svelte';

	interface Props {
		workstreamId: string;
		input: Readonly<Record<string, unknown>>;
		output: string | null;
		status: 'running' | 'completed' | 'failed';
	}

	let { workstreamId, input, output, status }: Props = $props();

	const SIZES: readonly WidgetSize[] = ['small', 'medium', 'large'];

	const uid = $props.id();
	const hintId = `${uid}-hint`;

	let chosen = $state<WidgetSize | null>(null);
	let width = $state(0);

	const saved = $derived(savedWidget(input, output));
	const widgetId = $derived(saved.widget?.id ?? '');
	const board = $derived(widgetBoardQuery.data(workstreamId));
	const widget = $derived(board?.widgets.find(({ id }) => id === widgetId) ?? saved.widget);
	const reading = $derived(widgetBoardQuery.reading(workstreamId, widgetId) ?? saved.reading);
	const placement = $derived(board?.placements.find((each) => each.widgetId === widgetId) ?? null);
	const size = $derived(placement?.size ?? chosen ?? widget?.size ?? 'medium');
	const fit = $derived(gallerySizes(width));
	const shown = $derived(fit.paged ? [size] : SIZES);
	const blocked = $derived(blockedReason());
	const pendingRun = $derived(
		placement === null && widget?.source.kind === 'command' ? widget.source.run : null,
	);

	$effect(() => watchWidgetsHook(workstreamId));

	function blockedReason(): string | null {
		if (status === 'running') return 'Saving the widget';
		if (status === 'failed' || widgetId === '') return 'The widget was not saved';
		return null;
	}

	function tileWidth(each: WidgetSize): number {
		const { columns } = WIDGET_SPANS[each];
		return fit.cell * columns + WIDGET_GAP * (columns - 1);
	}

	function tileHeight(each: WidgetSize): number {
		const { rows } = WIDGET_SPANS[each];
		return fit.cell * rows + WIDGET_GAP * (rows - 1);
	}

	function choose(next: WidgetSize): void {
		if (placement === null) chosen = next;
		else if (next !== placement.size) resizeWidgetCommand(workstreamId, widgetId, next);
	}

	function pin(): void {
		placeWidgetCommand(workstreamId, widgetId, null, size);
	}

	function startDrag(event: DragEvent): void {
		if (!event.dataTransfer) return;
		event.dataTransfer.setData(WIDGET_DRAG_TYPE, widgetId);
		event.dataTransfer.effectAllowed = 'copy';
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
			<div class="flex flex-col gap-2" bind:clientWidth={width}>
				<div class="flex items-start gap-4">
					{#each shown as each (each)}
						<div
							class="shrink-0 cursor-grab active:cursor-grabbing"
							style:width="{tileWidth(each)}px"
							style:height="{tileHeight(each)}px"
							role="presentation"
							draggable={blocked === null && placement === null}
							ondragstart={startDrag}
						>
							<WidgetTile {widget} {reading} size={each} sample={saved.sample} />
						</div>
					{/each}
				</div>
				<div
					class={[
						'flex gap-4',
						fit.paged &&
							'bg-surface-root border-border-default/60 gap-0.5 self-start rounded-[9px] border-[0.5px] p-0.5',
					]}
					role="radiogroup"
					aria-label="Size"
				>
					{#each SIZES as each (each)}
						<span class="flex" style:width={fit.paged ? undefined : `${tileWidth(each)}px`}>
							<Button
								size="sm"
								variant="ghost"
								role="radio"
								ariaChecked={each === size}
								active={each === size}
								onclick={() => choose(each)}
							>
								{WIDGET_SIZE_NAMES[each]}
							</Button>
						</span>
					{/each}
				</div>
			</div>
			<p class="text-fg-tertiary text-2xs mt-3 min-w-0 truncate leading-4">
				{#if pendingRun !== null}
					<span>Malini runs</span>
					<code class="text-fg-secondary font-mono">{pendingRun}</code>
					<span>once you pin it</span>
				{:else}
					<code class="font-mono">{sourceLine(widget)}</code>
				{/if}
			</p>
		</div>
		<Strip>
			{#if placement}
				<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
					<Icon name="check" size={12} />
					On your panel
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
				<span id={hintId} class="text-fg-tertiary min-w-0 truncate">
					{blocked ?? 'Or drag it to your panel'}
				</span>
				<Button
					variant="primary"
					size="sm"
					class="ml-auto"
					disabled={blocked !== null}
					ariaDescribedby={hintId}
					onclick={pin}
				>
					Pin to my panel
				</Button>
			{/if}
		</Strip>
	</section>
{/if}
