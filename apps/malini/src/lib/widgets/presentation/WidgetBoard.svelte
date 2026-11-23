<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import type { Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import {
		WIDGET_DRAG_TYPE,
		type WidgetDefinition,
		type WidgetPlacement,
		type WidgetReading,
		type WidgetSize,
	} from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { hideWidgetCommand } from '$lib/widgets/application/commands/hide-widget.command';
	import { loadWidgetBoardCommand } from '$lib/widgets/application/commands/load-widget-board.command';
	import { placeWidgetCommand } from '$lib/widgets/application/commands/place-widget.command';
	import { refreshWidgetCommand } from '$lib/widgets/application/commands/refresh-widget.command';
	import { removeWidgetCommand } from '$lib/widgets/application/commands/remove-widget.command';
	import { resizeWidgetCommand } from '$lib/widgets/application/commands/resize-widget.command';
	import { watchWidgetsHook } from '$lib/widgets/application/hooks/watch-widgets.hook';
	import { widgetBoardQuery } from '$lib/widgets/application/queries/widget-board.query.svelte';
	import { WIDGET_GAP, widgetGrid, widgetSpan } from '$lib/widgets/domain/widget-grid';
	import {
		DRAG_THRESHOLD,
		slotIndex,
		snappedSize,
		withPlaceholder,
		type Box,
		type Point,
	} from './widget-board-gestures';
	import WidgetMenu, { type WidgetMenuTarget } from './WidgetMenu.svelte';
	import WidgetSuggestionStack from './WidgetSuggestionStack.svelte';
	import WidgetTile from './WidgetTile.svelte';

	interface Props {
		workstreamId: string;
		onopen: (url: string) => void;
		onask: (prompt: string) => void;
		onopenfile?: ((path: string) => void) | undefined;
		plan?: Snippet<[WidgetSize]> | undefined;
		planHeader?: Snippet | undefined;
		planHref?: string | undefined;
	}

	type Tile = Readonly<{ widget: WidgetDefinition; placement: WidgetPlacement; index: number }>;

	type Basis = readonly WidgetPlacement[];

	type Lift = Readonly<{
		kind: 'tile' | 'suggestion' | 'file';
		widget: WidgetDefinition | null;
		size: WidgetSize;
		from: Box | null;
		offset: Point;
		at: number | null;
		landing: Box | null;
		basis: Basis | null;
	}>;

	type Sizing = Readonly<{ widgetId: string; size: WidgetSize; basis: Basis | null }>;

	let { workstreamId, onopen, onask, onopenfile, plan, planHeader, planHref }: Props = $props();

	const LAND_MS = 200;
	const SETTLE_MS = 2000;
	const DROP_MARGIN = 40;
	const ASK_PROMPT = 'Make me a widget that shows ';
	const FIELDS = 'input, textarea, select, [contenteditable="true"]';
	const ORIGIN: Point = { x: 0, y: 0 };
	const MOVES: Readonly<Record<string, number>> = {
		ArrowLeft: -1,
		ArrowUp: -1,
		ArrowRight: 1,
		ArrowDown: 1,
	};

	let width = $state(0);
	let height = $state(0);
	let area = $state<HTMLDivElement | null>(null);
	let lift = $state.raw<Lift | null>(null);
	let sizing = $state.raw<Sizing | null>(null);
	let menu = $state.raw<WidgetMenuTarget | null>(null);
	let keepFocus: Readonly<{ element: HTMLElement; basis: Basis }> | null = null;

	const board = $derived(widgetBoardQuery.data(workstreamId));
	const loadError = $derived(widgetBoardQuery.error(workstreamId));
	const me = $derived(board?.me ?? null);
	const grid = $derived(widgetGrid(width));
	const cell = $derived(Math.max(0, grid.cell));
	const tiles = $derived(placedTiles());
	const suggestions = $derived(
		board?.widgets.filter(
			({ id }) =>
				!board.hidden.includes(id) && !board.placements.some(({ widgetId }) => widgetId === id),
		) ?? [],
	);
	const shownLift = $derived(lift !== null && settled(lift.basis) ? null : lift);
	const shownSizing = $derived(sizing !== null && settled(sizing.basis) ? null : sizing);
	const liftedTile = $derived(
		shownLift?.kind === 'tile'
			? (tiles.find(({ widget }) => widget.id === shownLift.widget?.id) ?? null)
			: null,
	);
	const entries = $derived(withPlaceholder(tiles, liftedTile, shownLift?.at ?? null));
	const arranging = $derived(shownLift !== null || shownSizing !== null);
	const gridCells = $derived(
		grid.columns * Math.max(1, Math.ceil((height + WIDGET_GAP) / (cell + WIDGET_GAP))),
	);

	$effect(() => watchWidgetsHook(workstreamId));

	$effect(() => {
		const kept = keepFocus;
		if (kept === null || tiles.length === 0 || board?.placements === kept.basis) return;
		keepFocus = null;
		if (kept.element.isConnected && document.activeElement !== kept.element) kept.element.focus();
	});

	function placedTiles(): readonly Tile[] {
		if (!board) return [];
		return board.placements.flatMap((placement, index) => {
			const widget = board.widgets.find(({ id }) => id === placement.widgetId);
			return widget ? [{ widget, placement, index }] : [];
		});
	}

	function reading(widgetId: string): WidgetReading | null {
		return widgetBoardQuery.reading(workstreamId, widgetId);
	}

	function settled(basis: Basis | null): boolean {
		return basis !== null && board?.placements !== basis;
	}

	function sizeOf(tile: Tile): WidgetSize {
		return shownSizing?.widgetId === tile.widget.id ? shownSizing.size : tile.placement.size;
	}

	function homeOf(widget: WidgetDefinition | null): number | null {
		const index = tiles.findIndex((tile) => tile.widget.id === widget?.id);
		return index === -1 ? null : index;
	}

	function landMs(): number {
		return motionOff() ? 0 : LAND_MS;
	}

	function liftedBox(shown: Lift): Box | null {
		if (shown.landing) return shown.landing;
		if (!shown.from) return null;
		return {
			left: shown.from.left + shown.offset.x,
			top: shown.from.top + shown.offset.y,
			width: shown.from.width,
			height: shown.from.height,
		};
	}

	function otherBoxes(dragged: string | null): readonly Box[] {
		if (!area) return [];
		return [...area.querySelectorAll<HTMLElement>('[data-widget-slot]')]
			.filter((slot) => slot.dataset['widgetSlot'] !== dragged)
			.map((slot) => slot.getBoundingClientRect());
	}

	function placeholderBox(): Box | null {
		return area?.querySelector('[data-widget-placeholder]')?.getBoundingClientRect() ?? null;
	}

	function dropIndex(point: Point, dragged: string | null): number | null {
		if (!area) return null;
		const box = area.getBoundingClientRect();
		const inside =
			point.x > box.left - DROP_MARGIN &&
			point.x < box.right + DROP_MARGIN &&
			point.y > box.top - DROP_MARGIN &&
			point.y < box.bottom + DROP_MARGIN;
		return inside ? slotIndex(point, otherBoxes(dragged)) : null;
	}

	function settleLater(basis: Basis): void {
		window.setTimeout(() => {
			if (lift?.basis === basis) lift = null;
			if (sizing?.basis === basis) sizing = null;
		}, SETTLE_MS);
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

	function press(
		event: PointerEvent,
		kind: 'tile' | 'suggestion',
		widget: WidgetDefinition,
		size: WidgetSize,
		node: HTMLElement,
	): void {
		if (event.button !== 0 || shownLift !== null || shownSizing !== null) return;
		const start: Point = { x: event.clientX, y: event.clientY };
		const dragged = kind === 'tile' ? widget.id : null;
		let live = false;
		follow(
			event,
			(moved) => {
				const offset: Point = { x: moved.clientX - start.x, y: moved.clientY - start.y };
				if (!live && Math.hypot(offset.x, offset.y) < DRAG_THRESHOLD) return;
				if (!live) {
					live = true;
					menu = null;
					lift = {
						kind,
						widget,
						size,
						from: node.getBoundingClientRect(),
						offset,
						at: homeOf(widget),
						landing: null,
						basis: null,
					};
				}
				if (lift) lift = { ...lift, offset, at: dropIndex(moved, dragged) };
			},
			(cancelled) => {
				if (!live) return;
				swallowClick();
				release(cancelled);
			},
		);
	}

	function release(cancelled: boolean): void {
		const current = lift;
		if (current === null || current.from === null) return;
		const back = cancelled || current.at === null;
		lift = {
			...current,
			at: back ? (current.kind === 'tile' ? homeOf(current.widget) : null) : current.at,
			landing: back ? current.from : (placeholderBox() ?? current.from),
		};
		window.setTimeout(land, landMs());
	}

	function land(): void {
		const landed = lift;
		if (landed === null || landed.widget === null) return;
		const home = landed.kind === 'tile' ? homeOf(landed.widget) : null;
		if (landed.at === null || landed.at === home) {
			lift = null;
			return;
		}
		const basis = board?.placements ?? [];
		lift = { ...landed, basis };
		placeWidgetCommand(workstreamId, landed.widget.id, landed.at, null);
		settleLater(basis);
	}

	function startResize(event: PointerEvent, tile: Tile, node: HTMLElement): void {
		if (shownLift !== null || shownSizing !== null) return;
		event.preventDefault();
		event.stopPropagation();
		const start: Point = { x: event.clientX, y: event.clientY };
		const from = node.getBoundingClientRect();
		menu = null;
		sizing = { widgetId: tile.widget.id, size: tile.placement.size, basis: null };
		follow(
			event,
			(moved) => {
				if (sizing === null) return;
				const size = snappedSize(
					from.width + moved.clientX - start.x,
					from.height + moved.clientY - start.y,
					cell,
				);
				if (size !== sizing.size) sizing = { ...sizing, size };
			},
			(cancelled) => {
				swallowClick();
				const done = sizing;
				if (done === null || cancelled || done.size === tile.placement.size) {
					sizing = null;
					return;
				}
				const basis = board?.placements ?? [];
				sizing = { ...done, basis };
				resizeWidgetCommand(workstreamId, done.widgetId, done.size);
				settleLater(basis);
			},
		);
	}

	function startsDrag(target: Element, widget: WidgetDefinition): boolean {
		if (target.closest(`[data-widget-chrome], ${FIELDS}`)) return false;
		return widget.source.kind !== 'plan' || target.closest('button, a') === null;
	}

	function openMenu(tile: Tile, anchor: HTMLElement, point: Point | null): void {
		menu = {
			widget: tile.widget,
			size: tile.placement.size,
			reading: reading(tile.widget.id),
			approved: tile.placement.approved,
			anchor,
			point,
			openedAt: new Date(),
		};
	}

	function openMenuFrom(event: MouseEvent, tile: Tile): void {
		if (event.currentTarget instanceof HTMLElement) openMenu(tile, event.currentTarget, null);
	}

	function moveByKey(event: KeyboardEvent, tile: Tile): void {
		const step = MOVES[event.key];
		if (!event.altKey || step === undefined || !board) return;
		event.preventDefault();
		const index = tile.index + step;
		if (index < 0 || index >= tiles.length) return;
		if (document.activeElement instanceof HTMLElement) {
			keepFocus = { element: document.activeElement, basis: board.placements };
		}
		placeWidgetCommand(workstreamId, tile.widget.id, index, null);
	}

	function tileGestures(tile: Tile): (node: HTMLElement) => () => void {
		return (node) => {
			const down = (event: PointerEvent): void => {
				if (!(event.target instanceof Element) || event.button !== 0) return;
				if (event.target.closest('[data-widget-corner]')) startResize(event, tile, node);
				else if (startsDrag(event.target, tile.widget))
					press(event, 'tile', tile.widget, tile.placement.size, node);
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
				} else moveByKey(event, tile);
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

	function acceptDrops(node: HTMLElement): () => void {
		const carries = (event: DragEvent): boolean =>
			event.dataTransfer?.types.includes(WIDGET_DRAG_TYPE) ?? false;
		const over = (event: DragEvent): void => {
			if (!carries(event) || !event.dataTransfer) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			const at = slotIndex(event, otherBoxes(null));
			if (lift?.kind === 'file' && lift.at === at) return;
			lift = {
				kind: 'file',
				widget: null,
				size: 'medium',
				from: null,
				offset: ORIGIN,
				at,
				landing: null,
				basis: null,
			};
		};
		const leave = (event: DragEvent): void => {
			const box = node.getBoundingClientRect();
			const inside =
				event.clientX > box.left &&
				event.clientX < box.right &&
				event.clientY > box.top &&
				event.clientY < box.bottom;
			if (!inside && lift?.kind === 'file' && lift.basis === null) lift = null;
		};
		const drop = (event: DragEvent): void => {
			const widgetId = event.dataTransfer?.getData(WIDGET_DRAG_TYPE) ?? '';
			const at = lift?.kind === 'file' ? lift.at : null;
			if (widgetId === '' || lift === null || at === null) return;
			event.preventDefault();
			const home = tiles.findIndex((tile) => tile.widget.id === widgetId);
			const basis = board?.placements ?? [];
			lift = { ...lift, basis };
			placeWidgetCommand(workstreamId, widgetId, home !== -1 && home < at ? at - 1 : at, null);
			settleLater(basis);
		};
		node.addEventListener('dragover', over);
		node.addEventListener('dragleave', leave);
		node.addEventListener('drop', drop);
		return () => {
			node.removeEventListener('dragover', over);
			node.removeEventListener('dragleave', leave);
			node.removeEventListener('drop', drop);
		};
	}

	function liftedClass(landing: Box | null | undefined): readonly string[] {
		return [
			'shadow-popup pointer-events-none fixed z-100 rounded-2xl motion-reduce:transition-none',
			landing
				? 'transition-[left,top,width,height,scale] duration-200 ease-out'
				: 'scale-[1.03] transition-[scale] duration-150',
		];
	}

	function fromMenu(action: () => void): void {
		menu = null;
		action();
	}

	function resizeFromMenu(widget: WidgetDefinition, size: WidgetSize): void {
		const current = tiles.find((tile) => tile.widget.id === widget.id)?.placement.size;
		fromMenu(() => {
			if (size !== current) resizeWidgetCommand(workstreamId, widget.id, size);
		});
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
				bind:clientHeight={height}
				class="relative"
				{@attach acceptDrops}
			>
				<div
					class={[
						'pointer-events-none absolute inset-0 grid overflow-hidden transition-opacity duration-250',
						arranging ? 'opacity-100' : 'opacity-0',
					]}
					style:gap="{WIDGET_GAP}px"
					style:grid-template-columns="repeat({grid.columns}, {cell}px)"
					style:grid-auto-rows="{cell}px"
					aria-hidden="true"
				>
					{#each { length: gridCells }, index (index)}
						<span class="border-accent/15 rounded-2xl border border-dashed"></span>
					{/each}
				</div>
				<div
					class="relative grid grid-flow-dense"
					style:gap="{WIDGET_GAP}px"
					style:grid-template-columns="repeat({grid.columns}, {cell}px)"
					style:grid-auto-rows="{cell}px"
				>
					{#each entries as tile (tile?.widget.id ?? '')}
						{@const size = tile ? sizeOf(tile) : (shownLift?.size ?? 'medium')}
						{@const span = widgetSpan(size, grid.columns)}
						{@const box = tile && tile === liftedTile && shownLift ? liftedBox(shownLift) : null}
						<div
							class={[
								'group/slot widget-slot rounded-2xl',
								tile === null && 'border-border-default bg-accent/[3.5%] border border-dashed',
								box ? liftedClass(shownLift?.landing) : 'relative',
								tile !== null && shownSizing?.widgetId === tile.widget.id && 'ring-accent ring-1',
							]}
							style:grid-column="span {span.columns}"
							style:grid-row="span {span.rows}"
							style:left={box ? `${box.left}px` : undefined}
							style:top={box ? `${box.top}px` : undefined}
							style:width={box ? `${box.width}px` : undefined}
							style:height={box ? `${box.height}px` : undefined}
							data-widget-slot={tile?.widget.id}
							data-widget-placeholder={tile ? undefined : ''}
							aria-hidden={tile ? undefined : 'true'}
							animate:flip={{ duration: box || motionOff() ? 0 : 280, easing: cubicOut }}
							{@attach tile && tileGestures(tile)}
						>
							{#if tile}
								{@const { widget, placement } = tile}
								{@const madeBy =
									widget.author !== null && widget.author !== me ? widget.author : null}
								{#snippet authorMark()}
									{#if madeBy !== null}
										<GitHubUserAvatar login={madeBy} label="Made by {madeBy}" size={14} />
									{/if}
								{/snippet}
								{#snippet allow()}
									<span data-widget-chrome>
										<Button
											variant="secondary"
											size="xs"
											onclick={() =>
												placeWidgetCommand(workstreamId, widget.id, tile.index, placement.size)}
										>
											Allow
										</Button>
									</span>
								{/snippet}
								<WidgetTile
									{widget}
									reading={reading(widget.id)}
									{size}
									approved={placement.approved}
									{plan}
									{planHeader}
									titleHref={widget.source.kind === 'plan' ? planHref : undefined}
									{onopen}
									author={madeBy === null ? undefined : authorMark}
									actions={placement.approved || widget.source.kind !== 'command'
										? undefined
										: allow}
								/>
								<span
									class={[
										'absolute top-[7px] right-2 transition-opacity duration-150 group-focus-within/slot:opacity-100 group-hover/slot:opacity-100',
										menu?.widget.id === widget.id ? 'opacity-100' : 'opacity-0',
									]}
									data-widget-chrome
								>
									<Button
										bare
										class="bg-surface-elevated hover:bg-surface-150 text-fg-secondary hover:text-fg-default focus-visible:ring-border-default/50 grid size-6 cursor-pointer place-items-center rounded-[7px] outline-0 focus-visible:ring-2"
										ariaLabel="Options for {widget.title}"
										ariaHasPopup="menu"
										ariaExpanded={menu?.widget.id === widget.id}
										data-widget-menu=""
										onclick={(event) => openMenuFrom(event, tile)}
									>
										<Icon name="more" size={14} />
									</Button>
								</span>
								<span
									class={[
										'text-fg-tertiary absolute right-[3px] bottom-[3px] z-[3] size-[18px] cursor-nwse-resize touch-none transition-opacity duration-200 group-hover/slot:opacity-100',
										"after:absolute after:right-1 after:bottom-1 after:size-[7px] after:rounded-br-[4px] after:border-r-[1.5px] after:border-b-[1.5px] after:border-current after:content-['']",
										shownSizing?.widgetId === widget.id ? 'opacity-100' : 'opacity-0',
									]}
									data-widget-corner
									aria-hidden="true"
								></span>
							{/if}
						</div>
					{/each}
					<WidgetSuggestionStack
						{suggestions}
						readingOf={reading}
						{me}
						lifted={shownLift?.kind === 'suggestion' ? (shownLift.widget?.id ?? null) : null}
						{plan}
						onadd={(widget) => placeWidgetCommand(workstreamId, widget.id)}
						onhide={(widget) => hideWidgetCommand(workstreamId, widget.id)}
						onpress={(event, widget, card) => press(event, 'suggestion', widget, widget.size, card)}
					/>
					<Button
						bare
						class="border-border-default/60 hover:border-border-default text-fg-tertiary hover:text-fg-default focus-visible:ring-border-default/50 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-[0.5px] border-dashed text-xs outline-0 transition-[border-color,color] duration-200 focus-visible:ring-2"
						onclick={() => onask(ASK_PROMPT)}
					>
						<Icon name="sparkles" size={16} />Ask for a widget
					</Button>
				</div>
			</div>
			{#if shownLift?.kind === 'suggestion' && shownLift.widget}
				{@const box = liftedBox(shownLift)}
				{#if box}
					<div
						class={liftedClass(shownLift.landing)}
						style:left="{box.left}px"
						style:top="{box.top}px"
						style:width="{box.width}px"
						style:height="{box.height}px"
					>
						<WidgetTile
							widget={shownLift.widget}
							reading={reading(shownLift.widget.id)}
							size="medium"
							{plan}
						/>
					</div>
				{/if}
			{/if}
		{/if}
	</ScrollableDiv>
</section>

<WidgetMenu
	target={menu}
	onclose={() => (menu = null)}
	onresize={resizeFromMenu}
	onrefresh={(widget) => fromMenu(() => refreshWidgetCommand(workstreamId, widget.id))}
	onask={(widget, path) =>
		fromMenu(() => onask(`Change the "${widget.title}" widget in ${path}: `))}
	onopenfile={(_widget, path) => fromMenu(() => onopenfile?.(path))}
	onremove={(widget) => fromMenu(() => removeWidgetCommand(workstreamId, widget.id))}
/>

<style>
	.widget-slot:is(:hover, :focus-within) :global(article > header > span:last-child) {
		opacity: 0;
		transition: opacity 150ms;
	}
</style>
