<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import type {
		WidgetDefinition,
		WidgetPlacement,
		WidgetReading,
		WidgetSize,
		WidgetSpan,
	} from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { loadWidgetBoardCommand } from '$lib/widgets/application/commands/load-widget-board.command';
	import { placeWidgetCommand } from '$lib/widgets/application/commands/place-widget.command';
	import { removeWidgetCommand } from '$lib/widgets/application/commands/remove-widget.command';
	import { resizeWidgetCommand } from '$lib/widgets/application/commands/resize-widget.command';
	import { watchWidgetsHook } from '$lib/widgets/application/hooks/watch-widgets.hook';
	import { widgetBoardQuery } from '$lib/widgets/application/queries/widget-board.query.svelte';
	import { unplaced } from '$lib/widgets/domain/board-arrangement';
	import {
		WIDGET_GAP,
		dropIndex,
		inserted,
		pack,
		sameSpan,
		shownSpan,
		snappedSpan,
		widgetGrid,
		type GridPoint,
	} from '$lib/widgets/domain/widget-grid';
	import { showBoardGrid } from './board-grids.svelte';
	import WidgetMenu, { type WidgetMenuTarget } from './WidgetMenu.svelte';
	import WidgetShelf from './WidgetShelf.svelte';
	import WidgetTile from './WidgetTile.svelte';

	interface Props {
		workstreamId: string;
		onopen: (url: string) => void;
		onnew?: ((prompt: string) => void) | undefined;
		onshare?: ((widget: WidgetDefinition) => void) | undefined;
		plan?: Snippet<[WidgetSize]> | undefined;
		planHeader?: Snippet | undefined;
		planHref?: string | undefined;
	}

	type Tile = Readonly<{ widget: WidgetDefinition; placement: WidgetPlacement }>;

	type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

	type Drag = Readonly<{
		widgetId: string;
		from: number;
		to: number;
		grab: GridPoint;
		at: GridPoint;
	}>;

	type Sizing = Readonly<{ widgetId: string; span: WidgetSpan }>;

	let { workstreamId, onopen, onnew, onshare, plan, planHeader, planHref }: Props = $props();

	const DRAG_THRESHOLD = 4;
	const SETTLE_MS = 150;
	const FIELDS = 'input, textarea, select, [contenteditable="true"]';
	const KEY_SHORTCUTS = 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown';
	const ROW_KEYS: Readonly<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 };

	let width = $state(0);
	let area = $state<HTMLDivElement | null>(null);
	let drag = $state.raw<Drag | null>(null);
	let dropped = $state<string | null>(null);
	let sizing = $state.raw<Sizing | null>(null);
	let menu = $state.raw<WidgetMenuTarget | null>(null);

	const board = $derived(widgetBoardQuery.data(workstreamId));
	const loadError = $derived(widgetBoardQuery.error(workstreamId));
	const me = $derived(board?.me ?? null);
	const grid = $derived(widgetGrid(width));
	const step = $derived(Math.max(0, grid.cell) + WIDGET_GAP);
	const tiles = $derived(placedTiles());
	const order = $derived(shownOrder());
	const packed = $derived(pack(order.map(spanOf), grid.columns));
	const boxes = $derived(
		new Map(order.map((tile, index) => [tile.widget.id, boxOf(index, spanOf(tile))])),
	);
	const landing = $derived(drag === null ? null : (boxes.get(drag.widgetId) ?? null));
	const arranging = $derived(drag !== null || sizing !== null);
	const shelf = $derived(board === null ? [] : unplaced(board));

	$effect(() => watchWidgetsHook(workstreamId));

	$effect(() => {
		if (width > 0) showBoardGrid(workstreamId, grid);
	});

	function placedTiles(): readonly Tile[] {
		if (!board) return [];
		return board.placements.flatMap((placement) => {
			const widget = board.widgets.find(({ id }) => id === placement.widgetId);
			return widget ? [{ widget, placement }] : [];
		});
	}

	function shownOrder(): readonly Tile[] {
		const dragged =
			drag === null ? undefined : tiles.find(({ widget }) => widget.id === drag?.widgetId);
		if (drag === null || dragged === undefined) return tiles;
		return inserted(
			tiles.filter((tile) => tile !== dragged),
			drag.to,
			dragged,
		);
	}

	function spanOf(tile: Tile): WidgetSpan {
		return sizing?.widgetId === tile.widget.id ? sizing.span : tile.placement.span;
	}

	function boxOf(index: number, span: WidgetSpan): Box {
		const cell = packed.cells[index] ?? { column: 0, row: 0 };
		const shown = shownSpan(span, grid.columns);
		return {
			x: cell.column * step,
			y: cell.row * step,
			width: shown.columns * step - WIDGET_GAP,
			height: shown.rows * step - WIDGET_GAP,
		};
	}

	function translate({ x, y }: GridPoint): string {
		return `translate(${x}px, ${y}px)`;
	}

	function reading(widgetId: string): WidgetReading | null {
		return widgetBoardQuery.reading(workstreamId, widgetId);
	}

	function lifted(widgetId: string): boolean {
		return drag?.widgetId === widgetId;
	}

	function swallowClick(): void {
		const swallow = (event: MouseEvent): void => {
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener('click', swallow, { capture: true, once: true });
		window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
	}

	function follow(
		event: PointerEvent,
		onmove: (moved: PointerEvent) => void,
		onend: (cancelled: boolean) => void,
	): void {
		const noSelect = (selecting: Event): void => selecting.preventDefault();
		const move = (moved: PointerEvent): void => {
			if (moved.pointerId !== event.pointerId) return;
			if (moved.buttons === 0) finish(false);
			else onmove(moved);
		};
		const up = (ended: PointerEvent): void => {
			if (ended.pointerId === event.pointerId) finish(ended.type === 'pointercancel');
		};
		const escape = (key: KeyboardEvent): void => {
			if (key.key !== 'Escape') return;
			key.preventDefault();
			key.stopPropagation();
			finish(true);
		};
		function finish(cancelled: boolean): void {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			window.removeEventListener('keydown', escape, { capture: true });
			document.removeEventListener('selectstart', noSelect);
			onend(cancelled);
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
		window.addEventListener('keydown', escape, { capture: true });
		document.addEventListener('selectstart', noSelect);
	}

	function indexOf(tile: Tile): number {
		return tiles.findIndex(({ widget }) => widget.id === tile.widget.id);
	}

	function othersThan(tile: Tile): readonly WidgetSpan[] {
		return tiles
			.filter(({ widget }) => widget.id !== tile.widget.id)
			.map(({ placement }) => placement.span);
	}

	function press(event: PointerEvent, tile: Tile, node: HTMLElement): void {
		const box = boxes.get(tile.widget.id);
		const from = indexOf(tile);
		if (!area || !box || from === -1) return;
		const start = area.getBoundingClientRect();
		const grab = { x: event.clientX - start.left - box.x, y: event.clientY - start.top - box.y };
		const others = othersThan(tile);
		let live = false;
		follow(
			event,
			(moved) => {
				if (!area) return;
				if (!live) {
					const distance = Math.hypot(moved.clientX - event.clientX, moved.clientY - event.clientY);
					if (distance < DRAG_THRESHOLD) return;
					live = true;
					menu = null;
				}
				const now = area.getBoundingClientRect();
				const at = { x: moved.clientX - now.left - grab.x, y: moved.clientY - now.top - grab.y };
				const centre = { x: at.x + box.width / 2, y: at.y + box.height / 2 };
				const to = dropIndex(others, tile.placement.span, grid, centre, drag?.to ?? from);
				drag = { widgetId: tile.widget.id, from, to, grab, at };
			},
			(cancelled) => {
				if (!live) return;
				swallowClick();
				settle(node, cancelled);
			},
		);
	}

	function settle(node: HTMLElement, cancelled: boolean): void {
		const current = drag;
		if (current === null) return;
		const to = cancelled ? current.from : current.to;
		drag = null;
		if (to !== current.from) placeWidgetCommand(workstreamId, current.widgetId, to);
		const rest = boxes.get(current.widgetId);
		if (rest === undefined || motionOff()) return;
		dropped = current.widgetId;
		node.animate([{ transform: translate(current.at) }, { transform: translate(rest) }], {
			duration: SETTLE_MS,
			easing: 'cubic-bezier(0.2, 0, 0, 1)',
		});
		window.setTimeout(() => {
			if (dropped === current.widgetId) dropped = null;
		}, SETTLE_MS);
	}

	function startResize(event: PointerEvent, tile: Tile, node: HTMLElement): void {
		event.preventDefault();
		event.stopPropagation();
		const from = node.getBoundingClientRect();
		menu = null;
		sizing = { widgetId: tile.widget.id, span: tile.placement.span };
		follow(
			event,
			(moved) => {
				if (sizing === null) return;
				const span = snappedSpan(
					from.width + moved.clientX - event.clientX,
					from.height + moved.clientY - event.clientY,
					grid,
					tile.placement.span,
				);
				if (!sameSpan(span, sizing.span)) sizing = { ...sizing, span };
			},
			(cancelled) => {
				swallowClick();
				const done = sizing;
				sizing = null;
				if (done === null || cancelled || sameSpan(done.span, tile.placement.span)) return;
				resizeWidgetCommand(workstreamId, done.widgetId, done.span);
			},
		);
	}

	function startsDrag(target: Element, widget: WidgetDefinition): boolean {
		if (target.closest(`[data-widget-chrome], ${FIELDS}`)) return false;
		return widget.source.kind !== 'plan' || target.closest('button, a') === null;
	}

	function openMenu(tile: Tile, anchor: HTMLElement, point: GridPoint | null): void {
		menu = {
			widget: tile.widget,
			reading: reading(tile.widget.id),
			anchor,
			point,
			openedAt: new Date(),
		};
	}

	function keyedIndex(event: KeyboardEvent, tile: Tile): number | null {
		const index = indexOf(tile);
		const box = boxes.get(tile.widget.id);
		if (!event.altKey || index === -1 || !box) return null;
		if (event.key === 'ArrowLeft') return index - 1;
		if (event.key === 'ArrowRight') return index + 1;
		const rows = ROW_KEYS[event.key];
		if (rows === undefined) return null;
		const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 + rows * step };
		return dropIndex(othersThan(tile), tile.placement.span, grid, centre, index);
	}

	async function moveByKey(event: KeyboardEvent, tile: Tile): Promise<void> {
		const to = keyedIndex(event, tile);
		if (to === null) return;
		event.preventDefault();
		if (to < 0 || to >= tiles.length || to === indexOf(tile)) return;
		const focused = document.activeElement;
		placeWidgetCommand(workstreamId, tile.widget.id, to);
		await tick();
		if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
	}

	function tileGestures(tile: Tile): (node: HTMLElement) => () => void {
		return (node) => {
			const down = (event: PointerEvent): void => {
				if (!(event.target instanceof Element) || event.button !== 0) return;
				if (drag !== null || sizing !== null) return;
				if (event.target.closest('[data-widget-corner]')) startResize(event, tile, node);
				else if (startsDrag(event.target, tile.widget)) press(event, tile, node);
			};
			const context = (event: MouseEvent): void => {
				if (event.target instanceof Element && event.target.closest(FIELDS)) return;
				event.preventDefault();
				if (menu?.widget.id === tile.widget.id && menu.point === null) return;
				openMenu(tile, node, { x: event.clientX, y: event.clientY });
			};
			const key = (event: KeyboardEvent): void => {
				const button = node.querySelector<HTMLElement>('[data-widget-menu]');
				if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && button) {
					event.preventDefault();
					openMenu(tile, button, null);
				} else void moveByKey(event, tile);
			};
			node.addEventListener('pointerdown', down);
			node.addEventListener('contextmenu', context);
			node.addEventListener('keydown', key);
			return () => {
				node.removeEventListener('pointerdown', down);
				node.removeEventListener('contextmenu', context);
				node.removeEventListener('keydown', key);
			};
		};
	}

	function fromMenu(action: () => void): void {
		menu = null;
		action();
	}
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label="Widgets">
	<ScrollableDiv class="min-h-0 flex-1" contentClass="pb-3" testId="widget-board">
		{#if board === null}
			{#if loadError === null}
				<p class="text-fg-tertiary flex items-center gap-2 px-1 py-2 text-xs">
					<BusyIcon size={12} />Loading widgets
				</p>
			{:else}
				<div class="flex items-center gap-2 px-1 py-1 text-xs">
					<span class="text-fg-tertiary">Widgets did not load.</span>
					<Button variant="ghost" size="xs" onclick={() => loadWidgetBoardCommand(workstreamId)}>
						Try again
					</Button>
				</div>
			{/if}
		{:else}
			<div
				bind:this={area}
				bind:clientWidth={width}
				class={['relative', arranging && 'select-none']}
				style:height="{Math.max(0, packed.rows * step - WIDGET_GAP)}px"
			>
				{#if drag !== null && landing !== null}
					<div
						class="border-border-default bg-surface-root absolute top-0 left-0 rounded-2xl border border-dashed transition-transform duration-150 ease-out motion-reduce:transition-none"
						style:width="{landing.width}px"
						style:height="{landing.height}px"
						style:transform={translate(landing)}
						aria-hidden="true"
						data-widget-landing
					></div>
				{/if}
				{#each tiles as tile (tile.widget.id)}
					{@const { widget } = tile}
					{@const box = boxes.get(widget.id) ?? { x: 0, y: 0, width: 0, height: 0 }}
					{@const up = lifted(widget.id)}
					{@const madeBy = widget.author !== null && widget.author !== me ? widget.author : null}
					<div
						class={[
							'group/slot widget-slot absolute top-0 left-0 rounded-2xl',
							up
								? 'shadow-popup z-10 cursor-grabbing transition-[scale] duration-150 ease-out'
								: arranging &&
									'transition-transform duration-150 ease-out motion-reduce:transition-none',
							up && !motionOff() && 'scale-[1.02]',
							dropped === widget.id && 'z-10',
							sizing?.widgetId === widget.id &&
								"after:border-surface-150-border after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:border after:content-['']",
						]}
						style:width="{box.width}px"
						style:height="{box.height}px"
						style:transform={translate(up && drag ? drag.at : box)}
						data-widget-slot={widget.id}
						animate:flip={{
							duration: arranging || dropped === widget.id || motionOff() ? 0 : 200,
							easing: cubicOut,
						}}
						{@attach tileGestures(tile)}
					>
						{#snippet authorMark()}
							{#if madeBy !== null}
								<GitHubUserAvatar login={madeBy} label="Made by {madeBy}" size={14} />
							{/if}
						{/snippet}
						<WidgetTile
							{widget}
							reading={reading(widget.id)}
							span={spanOf(tile)}
							columns={grid.columns}
							{plan}
							{planHeader}
							titleHref={widget.source.kind === 'plan' ? planHref : undefined}
							{onopen}
							author={madeBy === null ? undefined : authorMark}
						/>
						<span
							class={[
								'absolute top-[7px] right-2 transition-opacity duration-150 group-focus-within/slot:opacity-100 group-hover/slot:opacity-100',
								menu?.widget.id === widget.id ? 'opacity-100' : 'opacity-0',
								arranging && 'invisible',
							]}
							data-widget-chrome
						>
							<Button
								bare
								class="bg-surface-elevated hover:bg-surface-150 text-fg-secondary hover:text-fg-default focus-visible:ring-border-default/50 grid size-6 cursor-pointer place-items-center rounded-[7px] outline-0 focus-visible:ring-2"
								ariaLabel="Options for {widget.title}"
								ariaHasPopup="menu"
								ariaExpanded={menu?.widget.id === widget.id}
								ariaKeyshortcuts={KEY_SHORTCUTS}
								data-widget-menu=""
								onclick={(event) => {
									if (event.currentTarget instanceof HTMLElement)
										openMenu(tile, event.currentTarget, null);
								}}
							>
								<Icon name="more" size={14} />
							</Button>
						</span>
						<span
							class={[
								'text-fg-tertiary absolute right-[3px] bottom-[3px] z-[3] size-[18px] cursor-nwse-resize touch-none transition-opacity duration-200 group-hover/slot:opacity-100',
								"after:absolute after:right-1 after:bottom-1 after:size-[7px] after:rounded-br-[4px] after:border-r-[1.5px] after:border-b-[1.5px] after:border-current after:content-['']",
								sizing?.widgetId === widget.id ? 'opacity-100' : 'opacity-0',
								drag !== null && 'invisible',
							]}
							data-widget-corner
							aria-hidden="true"
						></span>
					</div>
				{/each}
			</div>
			<WidgetShelf
				widgets={shelf}
				repository={board.repository}
				{me}
				{onnew}
				onadd={(widget) => placeWidgetCommand(workstreamId, widget.id, 0)}
			/>
		{/if}
	</ScrollableDiv>
</section>

<WidgetMenu
	target={menu}
	onclose={() => (menu = null)}
	onshare={onshare && ((widget) => fromMenu(() => onshare(widget)))}
	onremove={(widget) => fromMenu(() => removeWidgetCommand(workstreamId, widget.id))}
/>

<style>
	.widget-slot:is(:hover, :focus-within) :global(article > header > span:last-child) {
		opacity: 0;
		transition: opacity 150ms;
	}
</style>
