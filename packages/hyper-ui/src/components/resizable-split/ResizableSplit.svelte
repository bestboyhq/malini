<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
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
	} from './resizable-split';

	type CollapseBreakpoint = 'sm' | 'md' | 'lg';
	type ResizeAxis = 'horizontal' | 'vertical';

	interface Props {
		panelId: string;
		defaultSize?: number | undefined;
		defaultRatio?: number;
		minSize: number;
		maxSize: number;
		secondaryMinSize?: number;
		secondaryOpen?: boolean;
		collapseBelow?: CollapseBreakpoint;
		axis?: ResizeAxis;
		storageKey?: string;
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
		collapseBelow,
		axis = 'horizontal',
		storageKey,
		a,
		b,
		class: className,
		handleClass,
	}: Props = $props();

	const key = $derived(storageKey ?? defaultStorageKey(panelId));
	const fallbackSize = $derived(defaultSize ?? minSize);
	const ratioMode = $derived(defaultRatio !== undefined);
	const fallbackRatio = $derived(clampRatio(defaultRatio ?? 0.5));

	const BREAKPOINT_PX: Record<CollapseBreakpoint, number> = {
		sm: 640,
		md: 768,
		lg: 1024,
	};

	let size = $state(untrack(() => clampSize(defaultSize ?? minSize, minSize, maxSize)));
	let panelRatio = $state(untrack(() => clampRatio(defaultRatio ?? 0.5)));
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let isCollapsed = $state(false);

	let containerEl: HTMLDivElement | null = $state(null);

	let dragState: { pointerId: number; startX: number; startY: number; startSize: number } | null =
		null;
	let usingDefaultSize = false;

	const secondaryClosed = $derived(!secondaryOpen);
	const gridStyle = $derived(
		secondaryClosed ? closedSecondaryGridTemplate() : gridTemplate(size, axis),
	);
	const showHandle = $derived(!isCollapsed && !secondaryClosed);
	const orientation = $derived<ResizeAxis>(axis === 'horizontal' ? 'vertical' : 'horizontal');
	const containerExtent = $derived(axis === 'horizontal' ? containerWidth : containerHeight);
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
		usingDefaultSize = false;
		if (ratioMode && containerExtent > 0) {
			panelRatio = clampRatio(size / containerExtent);
		}
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
		if (isCollapsed) return;
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
		document.body.style.userSelect = 'none';
		document.body.style.cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize';
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const delta =
			axis === 'horizontal' ? event.clientX - dragState.startX : event.clientY - dragState.startY;
		applySize(dragState.startSize + delta);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const target = event.currentTarget;
		if (target instanceof HTMLButtonElement && target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
		persistSize();
		dragState = null;
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (isCollapsed) return;
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

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!collapseBelow) {
			isCollapsed = false;
			return;
		}
		const threshold = BREAKPOINT_PX[collapseBelow];
		const mql = window.matchMedia(`(max-width: ${threshold - 1}px)`);
		const sync = (): void => {
			isCollapsed = mql.matches;
		};
		sync();
		mql.addEventListener('change', sync);
		return () => {
			mql.removeEventListener('change', sync);
		};
	});

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
	onMount(() => {
		mounted = true;
		loadStored();
		if (!ratioMode) return;
		const observer = new ResizeObserver(measureContainer);
		if (containerEl) {
			observer.observe(containerEl);
		}
		return () => observer.disconnect();
	});

	$effect(() => {
		void key;
		void fallbackSize;
		if (!mounted) return;
		untrack(loadStored);
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
	class={[
		'grid h-full min-h-0 overflow-hidden',
		isCollapsed
			? 'grid-cols-1 grid-rows-[var(--resizable-split-rows)]'
			: axis === 'horizontal'
				? 'grid-cols-[var(--resizable-split-cols)]'
				: 'grid-rows-[var(--resizable-split-rows)]',
		className,
	]}
	style={isCollapsed
		? `--resizable-split-rows: ${secondaryClosed ? closedSecondaryGridTemplate() : 'auto auto'}`
		: axis === 'horizontal'
			? `--resizable-split-cols: ${gridStyle}`
			: `--resizable-split-rows: ${gridStyle}`}
	data-storage-key={key}
	data-storage-prefix="malini.app.panel"
	data-secondary-open={secondaryOpen ? 'true' : 'false'}
>
	<div class="min-h-0 min-w-0 overflow-hidden">
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
			class={['resizable-split-handle', handleClass]}
			data-axis={axis}
			data-panel-id={panelId}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			ondblclick={resetSize}
			onkeydown={onKeyDown}
		></button>
	{/if}
	<div class="min-h-0 min-w-0 overflow-hidden">
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
		margin-right: -8px;
		height: 100%;
		cursor: col-resize;
	}

	.resizable-split-handle[data-axis='vertical'] {
		height: 8px;
		margin-bottom: -8px;
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
		left: 0;
		width: 1px;
	}

	.resizable-split-handle[data-axis='vertical']::after {
		left: 0;
		right: 0;
		top: 0;
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
