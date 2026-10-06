<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		class?: string;
		viewportClass?: string;
		contentClass?: string;
		orientation?: 'x' | 'y' | 'xy';
		autoHideDelay?: number;
		thumbMinSize?: number;
		alwaysVisible?: boolean;
		reserveGutter?: boolean;
		viewportRef?: HTMLDivElement | null;
		onscroll?: (event: Event & { currentTarget: HTMLDivElement }) => void;
		children: Snippet;
		ariaLabel?: string;
		testId?: string;
	}

	let {
		class: className = '',
		viewportClass = '',
		contentClass = '',
		orientation = 'y',
		autoHideDelay = 900,
		thumbMinSize = 36,
		alwaysVisible = false,
		reserveGutter = false,
		viewportRef = $bindable(null),
		onscroll,
		children,
		ariaLabel,
		testId,
	}: Props = $props();

	let viewport: HTMLDivElement | null = $state(null);
	let content: HTMLDivElement | null = $state(null);
	let showVertical = $state(false);
	let showHorizontal = $state(false);
	let hasVerticalScroll = $state(false);
	let hasHorizontalScroll = $state(false);
	let thumbYHeight = $state(0);
	let thumbYTop = $state(0);
	let thumbXWidth = $state(0);
	let thumbXLeft = $state(0);
	let isDraggingY = $state(false);
	let isDraggingX = $state(false);
	let dragStartY = 0;
	let dragStartX = 0;
	let dragStartScrollTop = 0;
	let dragStartScrollLeft = 0;
	let hideTimeoutY: ReturnType<typeof setTimeout> | null = null;
	let hideTimeoutX: ReturnType<typeof setTimeout> | null = null;

	let trackHeight = 0;
	let trackWidth = 0;
	let maxScrollTop = 0;
	let maxScrollLeft = 0;
	let thumbFrame: number | null = null;

	const scrollsVertically = $derived(orientation === 'y' || orientation === 'xy');
	const scrollsHorizontally = $derived(orientation === 'x' || orientation === 'xy');

	const reservesVerticalGutter = $derived(reserveGutter && scrollsVertically);
	const reservesHorizontalGutter = $derived(reserveGutter && scrollsHorizontally);

	$effect(() => {
		viewportRef = viewport;
	});

	function measureExtents(): void {
		if (!viewport) return;
		const { scrollHeight, scrollWidth, clientHeight, clientWidth } = viewport;

		hasVerticalScroll = scrollsVertically && scrollHeight > clientHeight + 1;
		hasHorizontalScroll = scrollsHorizontally && scrollWidth > clientWidth + 1;
		trackHeight = clientHeight;
		trackWidth = clientWidth;
		maxScrollTop = Math.max(0, scrollHeight - clientHeight);
		maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

		if (hasVerticalScroll) {
			thumbYHeight = Math.round(
				Math.min(
					clientHeight,
					Math.max(thumbMinSize, (clientHeight / scrollHeight) * clientHeight),
				),
			);
		}

		if (hasHorizontalScroll) {
			thumbXWidth = Math.round(
				Math.min(clientWidth, Math.max(thumbMinSize, (clientWidth / scrollWidth) * clientWidth)),
			);
		}
	}

	function positionThumbs(): void {
		if (!viewport) return;
		if (hasVerticalScroll && maxScrollTop > 0) {
			const progress = Math.min(1, Math.max(0, viewport.scrollTop / maxScrollTop));
			thumbYTop = Math.round(progress * (trackHeight - thumbYHeight));
		}
		if (hasHorizontalScroll && maxScrollLeft > 0) {
			const progress = Math.min(1, Math.max(0, viewport.scrollLeft / maxScrollLeft));
			thumbXLeft = Math.round(progress * (trackWidth - thumbXWidth));
		}
	}

	function updateScrollbars(): void {
		measureExtents();
		positionThumbs();
	}

	function scheduleHide(axis: 'x' | 'y'): void {
		if (alwaysVisible) return;
		if (axis === 'y') {
			if (hideTimeoutY) clearTimeout(hideTimeoutY);
			hideTimeoutY = setTimeout(() => {
				if (!isDraggingY) showVertical = false;
			}, autoHideDelay);
			return;
		}
		if (hideTimeoutX) clearTimeout(hideTimeoutX);
		hideTimeoutX = setTimeout(() => {
			if (!isDraggingX) showHorizontal = false;
		}, autoHideDelay);
	}

	function handleScroll(event: Event & { currentTarget: HTMLDivElement }): void {
		onscroll?.(event);
		scheduleThumbSync();
	}

	function scheduleThumbSync(): void {
		if (thumbFrame !== null) return;
		thumbFrame = requestAnimationFrame(() => {
			thumbFrame = null;
			positionThumbs();
			if (hasVerticalScroll) {
				showVertical = true;
				scheduleHide('y');
			}
			if (hasHorizontalScroll) {
				showHorizontal = true;
				scheduleHide('x');
			}
		});
	}

	function handleVerticalTrackPointerDown(
		event: PointerEvent & { currentTarget: HTMLDivElement },
	): void {
		if (!viewport || event.target !== event.currentTarget) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
		viewport.scrollTop = ratio * maxScrollTop;
	}

	function handleHorizontalTrackPointerDown(
		event: PointerEvent & { currentTarget: HTMLDivElement },
	): void {
		if (!viewport || event.target !== event.currentTarget) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		viewport.scrollLeft = ratio * maxScrollLeft;
	}

	function startVerticalDrag(event: PointerEvent & { currentTarget: HTMLSpanElement }): void {
		if (!viewport) return;
		event.preventDefault();
		isDraggingY = true;
		showVertical = true;
		dragStartY = event.clientY;
		dragStartScrollTop = viewport.scrollTop;
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function moveVerticalThumb(event: PointerEvent): void {
		if (!isDraggingY || !viewport) return;
		const maxThumbTop = trackHeight - thumbYHeight;
		if (maxThumbTop <= 0) return;
		viewport.scrollTop =
			dragStartScrollTop + ((event.clientY - dragStartY) / maxThumbTop) * maxScrollTop;
	}

	function stopVerticalDrag(event: PointerEvent & { currentTarget: HTMLSpanElement }): void {
		if (!isDraggingY) return;
		isDraggingY = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		scheduleHide('y');
	}

	function startHorizontalDrag(event: PointerEvent & { currentTarget: HTMLSpanElement }): void {
		if (!viewport) return;
		event.preventDefault();
		isDraggingX = true;
		showHorizontal = true;
		dragStartX = event.clientX;
		dragStartScrollLeft = viewport.scrollLeft;
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function moveHorizontalThumb(event: PointerEvent): void {
		if (!isDraggingX || !viewport) return;
		const maxThumbLeft = trackWidth - thumbXWidth;
		if (maxThumbLeft <= 0) return;
		viewport.scrollLeft =
			dragStartScrollLeft + ((event.clientX - dragStartX) / maxThumbLeft) * maxScrollLeft;
	}

	function stopHorizontalDrag(event: PointerEvent & { currentTarget: HTMLSpanElement }): void {
		if (!isDraggingX) return;
		isDraggingX = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		scheduleHide('x');
	}

	$effect(() => {
		if (!viewport || !content) return;
		let measurementFrame: number | null = null;
		const scheduleScrollbarMeasurement = (): void => {
			if (measurementFrame !== null) return;
			measurementFrame = requestAnimationFrame(() => {
				measurementFrame = null;
				updateScrollbars();
			});
		};
		const resizeObserver = new ResizeObserver(scheduleScrollbarMeasurement);
		resizeObserver.observe(viewport);
		resizeObserver.observe(content);
		const mutationObserver = new MutationObserver(scheduleScrollbarMeasurement);
		if (scrollsHorizontally) mutationObserver.observe(content, { childList: true, subtree: true });
		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			if (measurementFrame !== null) cancelAnimationFrame(measurementFrame);
			if (thumbFrame !== null) cancelAnimationFrame(thumbFrame);
			if (hideTimeoutY) clearTimeout(hideTimeoutY);
			if (hideTimeoutX) clearTimeout(hideTimeoutX);
		};
	});
</script>

<div class={['scrollable-root relative overflow-hidden', className]}>
	<div
		bind:this={viewport}
		class={[
			'scrollable-viewport h-full max-h-[inherit] w-full',
			orientation === 'xy' && 'overflow-auto',
			orientation === 'x' && 'overflow-x-auto overflow-y-hidden',
			orientation === 'y' && 'overflow-x-hidden overflow-y-auto',
			viewportClass,
		]}
		aria-label={ariaLabel}
		data-testid={testId}
		onscroll={handleScroll}
	>
		<div
			bind:this={content}
			class={[
				'min-h-full min-w-full',
				reservesVerticalGutter && 'pr-2',
				reservesHorizontalGutter && 'pb-2',
				contentClass,
			]}
		>
			{@render children()}
		</div>
	</div>

	{#if hasVerticalScroll}
		<div
			class={[
				'absolute top-0 right-0 bottom-0 z-20 w-2 transition-opacity',
				alwaysVisible || showVertical ? 'opacity-100' : 'opacity-0 hover:opacity-100',
			]}
			aria-hidden="true"
			data-testid={testId ? `${testId}-scrollbar-y` : undefined}
			style="touch-action: none;"
			onpointerdown={handleVerticalTrackPointerDown}
		>
			<span
				class={['bg-border-default absolute right-0.5 w-1.5 cursor-default rounded-full']}
				role="presentation"
				style={`height: ${thumbYHeight}px; top: ${thumbYTop}px; touch-action: none;`}
				onpointerdown={startVerticalDrag}
				onpointermove={moveVerticalThumb}
				onpointerup={stopVerticalDrag}
				onpointercancel={stopVerticalDrag}
			></span>
		</div>
	{/if}

	{#if hasHorizontalScroll}
		<div
			class={[
				'absolute right-0 bottom-0 left-0 z-20 h-2 transition-opacity',
				alwaysVisible || showHorizontal ? 'opacity-100' : 'opacity-0 hover:opacity-100',
			]}
			aria-hidden="true"
			style="touch-action: none;"
			onpointerdown={handleHorizontalTrackPointerDown}
		>
			<span
				class={['bg-border-default absolute bottom-0.5 h-1.5 cursor-default rounded-full']}
				role="presentation"
				style={`width: ${thumbXWidth}px; left: ${thumbXLeft}px; touch-action: none;`}
				onpointerdown={startHorizontalDrag}
				onpointermove={moveHorizontalThumb}
				onpointerup={stopHorizontalDrag}
				onpointercancel={stopHorizontalDrag}
			></span>
		</div>
	{/if}
</div>

<style>
	.scrollable-viewport {
		overscroll-behavior: contain;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.scrollable-viewport::-webkit-scrollbar {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.scrollable-root :global(*) {
			transition-duration: 0ms !important;
		}
	}
</style>
