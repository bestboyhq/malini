<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AriaRole, ClassValue } from 'svelte/elements';
	import {
		announceExclusiveOverlayOpen,
		bodyPortal,
		calculatePosition,
		createRovingFocus,
		menuClose,
		menuOpen,
		overlaySurface,
		registerEscapeScope,
		resolveOverlayZIndex,
		type MenuAlign,
		type MenuSide,
	} from '../../overlay';
	import { shouldCloseDropdownFromDocumentClick } from '../dropdown/dropdown-click';

	interface Props {
		open: boolean;
		anchor: HTMLElement | null;
		onclose: () => void;
		children: Snippet;
		side?: MenuSide;
		align?: MenuAlign;
		offset?: number;
		alignOffset?: number;
		viewportPadding?: number;
		preventFlip?: boolean;
		matchAnchorWidth?: boolean;
		panelClass?: ClassValue;
		role?: AriaRole | null;
		testId?: string | undefined;
		backdropTestId?: string | undefined;
		owner?: string | undefined;
		restoreFocusToAnchor?: boolean;
		backdrop?: boolean;
		keyboardNavigation?: boolean;
		ignoreOpeningDocumentClick?: boolean;
		skipCloseTransition?: boolean;
	}

	let {
		open,
		anchor,
		onclose,
		children,
		side = 'bottom',
		align = 'start',
		offset = 8,
		alignOffset = 0,
		viewportPadding = 8,
		preventFlip = false,
		matchAnchorWidth = false,
		panelClass = '',
		role = 'menu',
		testId,
		backdropTestId,
		owner,
		restoreFocusToAnchor = true,
		backdrop = true,
		keyboardNavigation = true,
		ignoreOpeningDocumentClick = false,
		skipCloseTransition = false,
	}: Props = $props();

	let panelEl: HTMLDivElement | null = $state(null);
	// svelte-ignore state_referenced_locally
	let actualSide: MenuSide = $state(side);
	let wasOpen = false;
	let closeRequested = false;
	let ignoreDocumentClicksUntil = 0;
	let triggerFollowRaf: number | null = null;
	let lastAnchorRect: { x: number; y: number; width: number; height: number } | null = null;
	const zIndex = $derived(resolveOverlayZIndex(anchor));

	function triggerElement(): HTMLElement | null {
		if (!anchor) return null;
		if (anchor.hasAttribute('data-dropdown-anchor')) return anchor;
		return (
			anchor.querySelector<HTMLElement>(
				'[data-dropdown-anchor], [data-hyper-button], button, a[href], input, [role="button"]',
			) ?? anchor
		);
	}

	function positionCard(): void {
		const trigger = triggerElement();
		if (!open || !trigger || !panelEl) return;
		if (matchAnchorWidth) {
			panelEl.style.width = `${trigger.getBoundingClientRect().width}px`;
		}
		const layoutRect: DOMRect = {
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			width: panelEl.offsetWidth,
			height: panelEl.offsetHeight,
			right: panelEl.offsetWidth,
			bottom: panelEl.offsetHeight,
			toJSON: () => ({}),
		};
		const position = calculatePosition(trigger.getBoundingClientRect(), layoutRect, {
			side,
			align,
			sideOffset: offset,
			alignOffset,
			preventFlip,
			viewportPadding,
		});
		panelEl.style.top = `${position.top}px`;
		panelEl.style.left = `${position.left}px`;
		actualSide = position.actualSide;
	}

	function mountPanel(node: HTMLDivElement): { destroy: () => void } {
		panelEl = node;
		positionCard();
		return {
			destroy: () => {
				if (panelEl === node) panelEl = null;
			},
		};
	}

	const roving = createRovingFocus({
		container: () => panelEl,
		anchor: triggerElement,
		restoreFocus: () => restoreFocusToAnchor,
		canRestore: () => !open,
	});

	function requestClose(): void {
		if (closeRequested) return;
		closeRequested = true;
		onclose();
		void roving.restoreAnchorFocus();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (!open) return;
		roving.handleArrowKeys(event);
	}

	function onDocumentClick(event: MouseEvent): void {
		if (event.timeStamp <= ignoreDocumentClicksUntil) return;
		const targetNode = event.target instanceof Node ? event.target : null;
		const targetElement =
			event.target instanceof Element ? event.target : targetNode?.parentElement;
		const targetDialog = targetElement?.closest('[role="dialog"]') ?? null;
		if (
			shouldCloseDropdownFromDocumentClick({
				targetInsideTrigger: targetNode ? (anchor?.contains(targetNode) ?? false) : false,
				targetInsideCard: targetNode ? (panelEl?.contains(targetNode) ?? false) : false,
				targetInsideSubmenuPortal: targetNode
					? Array.from(document.querySelectorAll('[data-submenu-portal]')).some((portal) =>
							portal.contains(targetNode),
						)
					: false,
				targetInsideDialog: targetDialog !== null,
				triggerInsideTargetDialog: Boolean(anchor && targetDialog?.contains(anchor)),
			})
		) {
			requestClose();
		}
	}

	function startAnchorFollow(): void {
		const follow = (): void => {
			if (!open || !anchor) {
				triggerFollowRaf = null;
				return;
			}
			const trigger = triggerElement();
			if (!trigger) {
				triggerFollowRaf = null;
				return;
			}
			const rect = trigger.getBoundingClientRect();
			if (
				!lastAnchorRect ||
				rect.x !== lastAnchorRect.x ||
				rect.y !== lastAnchorRect.y ||
				rect.width !== lastAnchorRect.width ||
				rect.height !== lastAnchorRect.height
			) {
				lastAnchorRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				positionCard();
			}
			triggerFollowRaf = requestAnimationFrame(follow);
		};
		triggerFollowRaf = requestAnimationFrame(follow);
	}

	$effect(() => {
		if (!open) return;
		const trigger = triggerElement();
		if (!trigger) return;
		trigger.setAttribute('data-dropdown-open', 'true');
		return () => trigger.removeAttribute('data-dropdown-open');
	});

	$effect(() => {
		if (!open) {
			if (wasOpen) {
				wasOpen = false;
				void roving.restoreAnchorFocus();
			}
			return;
		}
		wasOpen = true;
		closeRequested = false;
		ignoreDocumentClicksUntil = ignoreOpeningDocumentClick ? performance.now() + 100 : 0;
		announceExclusiveOverlayOpen();
		actualSide = side;
	});

	$effect(() => {
		if (!open || !panelEl) return;
		positionCard();
		const resizeObserver = new ResizeObserver(positionCard);
		resizeObserver.observe(panelEl);
		const trigger = triggerElement();
		if (trigger) resizeObserver.observe(trigger);
		startAnchorFollow();
		document.addEventListener('click', onDocumentClick, true);
		const releaseEscape = keyboardNavigation ? registerEscapeScope(requestClose) : null;
		if (keyboardNavigation) document.addEventListener('keydown', onKeydown);
		document.addEventListener('scroll', positionCard, true);
		window.addEventListener('resize', positionCard);
		return () => {
			resizeObserver.disconnect();
			if (triggerFollowRaf !== null) cancelAnimationFrame(triggerFollowRaf);
			triggerFollowRaf = null;
			lastAnchorRect = null;
			releaseEscape?.();
			document.removeEventListener('click', onDocumentClick, true);
			document.removeEventListener('keydown', onKeydown);
			document.removeEventListener('scroll', positionCard, true);
			window.removeEventListener('resize', positionCard);
		};
	});
</script>

{#if open}
	<div
		class="pointer-events-none fixed inset-0"
		style:z-index={zIndex}
		data-overlay-layer
		data-overlay-owner={owner}
		use:bodyPortal
	>
		{#if backdrop}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				role="presentation"
				class="pointer-events-auto fixed inset-0 z-0 cursor-default bg-transparent"
				data-dropdown-backdrop
				data-overlay-backdrop
				data-testid={backdropTestId}
				onclick={requestClose}
				oncontextmenu={(event) => {
					event.preventDefault();
					requestClose();
				}}
			></div>
		{/if}
		<div
			use:mountPanel
			class={['shadow-popup pointer-events-auto fixed z-[1]', panelClass]}
			style:z-index="1"
			style:top="0px"
			style:left="0px"
			data-dropdown-portal
			use:overlaySurface={{ anchored: true }}
			data-side={actualSide}
			data-testid={testId}
			{role}
			tabindex="-1"
			in:menuOpen|global={{ side: actualSide, align }}
			out:menuClose|global={{ side: actualSide, align, skip: skipCloseTransition }}
		>
			{@render children()}
		</div>
	</div>
{/if}
