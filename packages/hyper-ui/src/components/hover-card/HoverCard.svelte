<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import {
		announceExclusiveOverlayOpen,
		bodyPortal,
		calculatePosition,
		menuClose,
		menuOpen,
		onExclusiveOverlayOpen,
		overlaySurface,
		resolveOverlayZIndex,
	} from '../../overlay';

	type Side = 'top' | 'bottom' | 'left' | 'right';
	type Align = 'start' | 'center' | 'end';

	interface Props {
		trigger: Snippet<[{ open: boolean }]>;
		content: Snippet;
		side?: Side;
		align?: Align;
		sideOffset?: number;
		openDelay?: number;
		closeDelay?: number;
		triggerClass?: ClassValue;
		panelClass?: ClassValue;
		testId?: string;
		backdropTestId?: string;
		owner?: string;
		open?: boolean;
		onopenchange?: (open: boolean) => void;
	}

	let {
		trigger,
		content,
		side = 'top',
		align = 'center',
		sideOffset = 8,
		openDelay = 0,
		closeDelay = 150,
		triggerClass = '',
		panelClass = '',
		testId,
		backdropTestId,
		owner,
		open = $bindable(false),
		onopenchange,
	}: Props = $props();

	let triggerEl: HTMLSpanElement;
	let cardEl: HTMLDivElement | null = $state(null);
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let pinned = $state(false);
	let hoverSuppressed = false;
	let overlayZIndex = $state(1_000);
	// svelte-ignore state_referenced_locally
	let activeSide = $state<Side>(side);

	function setOpen(next: boolean): void {
		if (open === next) return;
		if (next) overlayZIndex = resolveOverlayZIndex(triggerEl);
		open = next;
		onopenchange?.(next);
	}

	function clearTimers(): void {
		if (openTimer) clearTimeout(openTimer);
		if (closeTimer) clearTimeout(closeTimer);
		openTimer = null;
		closeTimer = null;
	}

	function requestOpen(immediate = false): void {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = null;
		if (open || openTimer) return;
		if (immediate || openDelay === 0) {
			announceExclusiveOverlayOpen();
			setOpen(true);
			return;
		}
		openTimer = setTimeout(() => {
			openTimer = null;
			announceExclusiveOverlayOpen();
			setOpen(true);
		}, openDelay);
	}

	function requestClose(immediate = false): void {
		if (openTimer) clearTimeout(openTimer);
		openTimer = null;
		if (pinned) return;
		if (immediate || closeDelay === 0) {
			setOpen(false);
			return;
		}
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			closeTimer = null;
			setOpen(false);
		}, closeDelay);
	}

	function togglePinned(): void {
		clearTimers();
		const nextPinned = !pinned;
		const nextOpen = nextPinned || !open;
		if (nextOpen && !open) announceExclusiveOverlayOpen();
		pinned = nextPinned;
		setOpen(nextOpen);
	}

	function onTriggerPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		hoverSuppressed = false;
		togglePinned();
	}

	function onTriggerClick(event: MouseEvent): void {
		if (event.detail !== 0) return;
		togglePinned();
	}

	function onDocumentPointerDown(event: PointerEvent): void {
		if (!open || !(event.target instanceof Node)) return;
		if (triggerEl.contains(event.target) || cardEl?.contains(event.target)) return;
		if (pinned) event.preventDefault();
		pinned = false;
		setOpen(false);
	}

	function closeFromBackdrop(event: PointerEvent): void {
		event.preventDefault();
		pinned = false;
		setOpen(false);
	}

	function onDocumentKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !open) return;
		pinned = false;
		hoverSuppressed = true;
		triggerEl.querySelector<HTMLElement>('button,[href],[tabindex]')?.focus();
		setOpen(false);
	}

	function dismissForExclusiveOverlay(): void {
		clearTimers();
		pinned = false;
		setOpen(false);
	}

	function resetPortalState(): void {
		resizeObserver?.disconnect();
		resizeObserver = null;
		cardEl = null;
	}

	function positionCard(): void {
		if (!cardEl || !triggerEl) return;
		const triggerRect = triggerEl.getBoundingClientRect();
		const cardRect = cardEl.getBoundingClientRect();
		const position = calculatePosition(triggerRect, cardRect, {
			side,
			align,
			sideOffset,
			alignOffset: 0,
			viewportPadding: 8,
		});

		cardEl.style.position = 'fixed';
		cardEl.style.left = `${position.left}px`;
		cardEl.style.top = `${position.top}px`;
		cardEl.style.pointerEvents = 'auto';
		activeSide = position.actualSide;
	}

	$effect(() => {
		if (!open) {
			pinned = false;
			clearTimers();
			resetPortalState();
			return;
		}
		positionCard();
		if (cardEl) {
			resizeObserver?.disconnect();
			resizeObserver = new ResizeObserver(positionCard);
			resizeObserver.observe(cardEl);
		}
	});

	$effect(() => {
		return onExclusiveOverlayOpen(dismissForExclusiveOverlay);
	});

	$effect(() => {
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		document.addEventListener('keydown', onDocumentKeydown);
		window.addEventListener('resize', positionCard);
		window.addEventListener('scroll', positionCard, true);
		return () => {
			clearTimers();
			resetPortalState();
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			document.removeEventListener('keydown', onDocumentKeydown);
			window.removeEventListener('resize', positionCard);
			window.removeEventListener('scroll', positionCard, true);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<span
	bind:this={triggerEl}
	class={['inline-flex', triggerClass]}
	role="group"
	data-hovercard-trigger
	onmouseenter={() => {
		if (!hoverSuppressed) requestOpen();
	}}
	onmouseleave={() => {
		hoverSuppressed = false;
		requestClose();
	}}
	onfocusin={() => requestOpen(true)}
	onfocusout={(event) => {
		if (event.relatedTarget instanceof Node && cardEl?.contains(event.relatedTarget)) return;
		requestClose();
	}}
	onpointerdown={onTriggerPointerDown}
	onclick={onTriggerClick}
>
	{@render trigger({ open })}
</span>

{#if open}
	<div
		class="pointer-events-none fixed inset-0"
		style:z-index={overlayZIndex}
		data-overlay-layer
		data-overlay-owner={owner}
		use:bodyPortal
	>
		{#if pinned}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				role="presentation"
				class="pointer-events-auto fixed inset-0 z-0 cursor-default bg-transparent"
				data-hovercard-backdrop
				data-overlay-backdrop
				data-overlay-owner={owner}
				data-testid={backdropTestId}
				onpointerdown={closeFromBackdrop}
				oncontextmenu={(event) => {
					event.preventDefault();
					pinned = false;
					setOpen(false);
				}}
			></div>
		{/if}
		<div
			role="presentation"
			bind:this={cardEl}
			data-hovercard-portal
			use:overlaySurface={{ anchored: true }}
			data-overlay-owner={owner}
			data-side={activeSide}
			data-testid={testId}
			class={['shadow-popup z-[1]', panelClass]}
			style="position: fixed; top: 0; left: 0; pointer-events: auto;"
			in:menuOpen|global={{ side: activeSide, align }}
			out:menuClose|global={{ side: activeSide, align }}
			onmouseenter={() => requestOpen(true)}
			onmouseleave={() => requestClose()}
		>
			{@render content()}
		</div>
	</div>
{/if}
