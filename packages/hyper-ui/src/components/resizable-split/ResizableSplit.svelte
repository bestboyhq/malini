<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { setResizableSplitInset } from './resizable-split-inset';
	import type { ClassValue } from 'svelte/elements';
	import {
		clampRatio,
		clampSize,
		closedSecondaryGridTemplate,
		defaultStorageKey,
		gridTemplate,
		loadPanelSize,
		readPanelRatio,
		savePanelRatio,
		savePanelSize,
		secondaryGridTemplate,
	} from './resizable-split';

	type ResizeAxis = 'horizontal' | 'vertical';

	interface Props {
		panelId: string;
		defaultSize?: number | undefined;
		defaultRatio?: number;
		minSize: number;
		maxSize: number;
		secondaryMinSize?: number;
		secondaryOpen?: boolean;
		axis?: ResizeAxis;
		storageKey?: string;
		scope?: string;
		a: Snippet;
		b: Snippet;
		class?: ClassValue;
		handleClass?: ClassValue;
	}

	let {
		panelId,
		defaultSize,
		defaultRatio,
		minSize,
		maxSize,
		secondaryMinSize = 0,
		secondaryOpen = true,
		axis = 'horizontal',
		storageKey,
		scope,
		a,
		b,
		class: className,
		handleClass,
	}: Props = $props();

	const key = $derived(storageKey ?? defaultStorageKey(panelId));
	const fallbackSize = $derived(defaultSize ?? minSize);
	const ratioMode = $derived(defaultRatio !== undefined);
	const fallbackRatio = $derived(clampRatio(defaultRatio ?? 0.5));

	let size = $state(untrack(() => clampSize(defaultSize ?? minSize, minSize, maxSize)));
	let panelRatio = $state(untrack(() => clampRatio(defaultRatio ?? 0.5)));
	let containerWidth = $state(0);
	let containerHeight = $state(0);

	let secondaryWidth = $state(0);
	let secondaryHeight = $state(0);

	let containerEl: HTMLDivElement | null = $state(null);

	let dragState: { pointerId: number; startX: number; startY: number; startSize: number } | null =
		null;
	let usingDefaultSize = false;
	const easedSize = new Tween(0, { duration: 240, easing: cubicOut });
	let easing = $state(false);
	const shownSize = $derived(easing ? easedSize.current : size);

	const secondaryClosed = $derived(!secondaryOpen);
	const showHandle = $derived(!secondaryClosed);
	const orientation = $derived<ResizeAxis>(axis === 'horizontal' ? 'vertical' : 'horizontal');
	const placement = $derived(
		axis === 'horizontal'
			? {
					primary: 'col-span-full row-start-1',
					handle: 'col-start-2 row-start-1',
					secondary: '-col-start-2 row-start-1',
				}
			: {
					primary: 'col-start-1 row-span-full',
					handle: 'col-start-1 row-start-2',
					secondary: 'col-start-1 -row-start-2',
				},
	);
	const containerExtent = $derived(axis === 'horizontal' ? containerWidth : containerHeight);
	const measuredSecondarySize = $derived(axis === 'horizontal' ? secondaryWidth : secondaryHeight);
	const secondarySize = $derived.by(() => {
		if (secondaryClosed || containerExtent <= 0) return measuredSecondarySize;
		const track = Math.round(shownSize);
		return axis === 'horizontal' ? Math.max(0, containerExtent - track) : track;
	});
	const gridStyle = $derived.by(() => {
		if (secondaryClosed) return closedSecondaryGridTemplate();
		if (containerExtent <= 0) return gridTemplate(size, axis);
		return secondaryGridTemplate(secondarySize);
	});
	setResizableSplitInset({
		get extent() {
			return containerExtent;
		},
		get secondarySize() {
			return secondarySize;
		},
	});
	const effectiveMaxSize = $derived.by(() => {
		if (containerExtent <= 0 || secondaryMinSize <= 0) {
			return maxSize;
		}
		const available = containerExtent - secondaryMinSize - 8;
		return Math.max(minSize, Math.min(maxSize, available));
	});

	function applySize(next: number, updateRatio = true): void {
		size = clampSize(next, minSize, effectiveMaxSize);
		if (!updateRatio) return;
		easing = false;
		usingDefaultSize = false;
		if (ratioMode && containerExtent > 0) {
			panelRatio = clampRatio(size / containerExtent);
		}
	}

	export function growSecondary(by: number): void {
		if (secondaryClosed || containerExtent <= 0) return;
		applySize(axis === 'horizontal' ? size - by : size + by);
		persistSize();
	}

	function persistSize(): void {
		if (ratioMode) {
			savePanelRatio(key, panelRatio);
			return;
		}
		savePanelSize(key, size);
	}

	function resetSize(): void {
		if (ratioMode && containerExtent > 0 && defaultSize === undefined) {
			panelRatio = fallbackRatio;
			applySize(containerExtent * panelRatio, false);
		} else {
			applySize(fallbackSize);
		}
		persistSize();
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 && event.pointerType === 'mouse') return;
		event.preventDefault();
		const target = event.currentTarget;
		if (!(target instanceof HTMLButtonElement)) return;
		target.setPointerCapture(event.pointerId);
		dragState = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startSize: size,
		};
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		if (event.buttons === 0) {
			endDrag(event);
			return;
		}
		const delta =
			axis === 'horizontal' ? event.clientX - dragState.startX : event.clientY - dragState.startY;
		applySize(dragState.startSize + delta);
	}

	function endDrag(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const target = event.currentTarget;
		if (target instanceof HTMLButtonElement && target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		persistSize();
		dragState = null;
	}

	function onKeyDown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 16 : 1;
		if (axis === 'horizontal') {
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				applySize(size - step);
				persistSize();
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				applySize(size + step);
				persistSize();
			}
		} else {
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				applySize(size - step);
				persistSize();
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();
				applySize(size + step);
				persistSize();
			}
		}
		if (event.key === 'Home') {
			event.preventDefault();
			applySize(minSize);
			persistSize();
		} else if (event.key === 'End') {
			event.preventDefault();
			applySize(maxSize);
			persistSize();
		}
	}

	function loadStored(): void {
		if (!ratioMode) {
			size = loadPanelSize(key, fallbackSize, minSize, maxSize);
			return;
		}
		const storedRatio = readPanelRatio(key);
		panelRatio = storedRatio ?? fallbackRatio;
		usingDefaultSize = storedRatio === null && defaultSize !== undefined;
		syncToContainer();
	}

	async function easeFrom(from: number): Promise<void> {
		easing = !prefersReducedMotion.current && Math.round(from) !== Math.round(size);
		if (!easing) return;
		void easedSize.set(from, { duration: 0 });
		await easedSize.set(size);
		easing = false;
	}

	function measureContainer(): void {
		if (!containerEl) return;
		containerWidth = containerEl.clientWidth;
		containerHeight = containerEl.clientHeight;
	}

	function syncToContainer(): void {
		measureContainer();
		if (!ratioMode || containerExtent <= 0) return;
		applySize(usingDefaultSize ? fallbackSize : containerExtent * panelRatio, false);
	}

	let mounted = false;
	let presetLoaded = false;
	let loadedScope = untrack(() => scope);
	onMount(() => {
		mounted = true;
		loadStored();
		const observer = new ResizeObserver(measureContainer);
		if (containerEl) {
			observer.observe(containerEl);
		}
		return () => observer.disconnect();
	});

	$effect(() => {
		void key;
		void fallbackSize;
		const nextScope = scope;
		if (!mounted) return;
		untrack(() => {
			const from = shownSize;
			loadStored();
			if (presetLoaded && nextScope === loadedScope) void easeFrom(from);
			else easing = false;
			presetLoaded = true;
			loadedScope = nextScope;
		});
	});

	$effect(() => {
		const ceiling = effectiveMaxSize;
		if (!mounted) return;
		untrack(() => {
			if (size <= ceiling) return;
			applySize(ceiling, false);
		});
	});

	$effect(() => {
		const extent = containerExtent;
		if (!mounted || !ratioMode || extent <= 0) return;
		untrack(() => applySize(usingDefaultSize ? fallbackSize : extent * panelRatio, false));
	});
</script>

<div
	bind:this={containerEl}
	class={['grid h-full min-h-0 overflow-hidden', className]}
	style:grid-template-columns={axis === 'horizontal' ? gridStyle : undefined}
	style:grid-template-rows={axis === 'horizontal' ? undefined : gridStyle}
	data-storage-key={key}
	data-storage-prefix="malini.app.panel"
	data-secondary-open={secondaryOpen ? 'true' : 'false'}
>
	<div class={['min-h-0 min-w-0 overflow-hidden', placement.primary]}>
		{@render a()}
	</div>
	{#if showHandle}
		<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
		<button
			type="button"
			role="separator"
			aria-orientation={orientation}
			aria-valuemin={minSize}
			aria-valuemax={effectiveMaxSize}
			aria-valuenow={Math.round(size)}
			aria-label={`Resize ${panelId}`}
			tabindex="0"
			class={['resizable-split-handle', placement.handle, handleClass]}
			data-axis={axis}
			data-panel-id={panelId}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onlostpointercapture={endDrag}
			ondblclick={resetSize}
			onkeydown={onKeyDown}
		></button>
	{/if}
	<div
		bind:clientWidth={secondaryWidth}
		bind:clientHeight={secondaryHeight}
		class={['min-h-0 min-w-0 overflow-hidden', placement.secondary]}
	>
		{@render b()}
	</div>
</div>

<style>
	.resizable-split-handle {
		position: relative;
		background: transparent;
		display: flex;
		align-items: stretch;
		justify-content: center;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		touch-action: none;
	}

	.resizable-split-handle[data-axis='horizontal'] {
		width: 8px;
		margin-inline: -4px;
		height: 100%;
		cursor: col-resize;
	}

	.resizable-split-handle[data-axis='vertical'] {
		height: 8px;
		margin-block: -4px;
		width: 100%;
		cursor: row-resize;
	}

	.resizable-split-handle::after {
		position: absolute;
		content: '';
		background: transparent;
	}

	.resizable-split-handle[data-axis='horizontal']::after {
		top: 0;
		bottom: 0;
		left: 4px;
		width: 1px;
	}

	.resizable-split-handle[data-axis='vertical']::after {
		left: 0;
		right: 0;
		top: 4px;
		height: 1px;
	}

	.resizable-split-handle:hover::after {
		background: var(--color-border-subtle);
	}

	.resizable-split-handle:focus-visible::after {
		background: var(--color-border-default);
	}

	.resizable-split-handle:focus-visible {
		outline: none;
	}
</style>
