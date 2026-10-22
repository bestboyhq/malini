<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AriaRole, ClassValue } from 'svelte/elements';
	import {
		anchorRect,
		announceExclusiveOverlayOpen,
		bodyPortal,
		calculatePosition,
		createRovingFocus,
		layoutRect,
		getOverlayFocusReturn,
		menuClose,
		menuOpen,
		overlaySurface,
		registerEscapeScope,
		resolveOverlayZIndex,
		transformOriginFor,
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
		owner?: string | undefined;
		restoreFocusToAnchor?: boolean;
		keyboardNavigation?: boolean;
		closeOnEscape?: boolean;
		backdrop?: boolean;
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
		owner,
		restoreFocusToAnchor = true,
		keyboardNavigation = true,
		closeOnEscape = true,
		backdrop = false,
	}: Props = $props();

	let panelEl: HTMLDivElement | null = $state(null);
	// svelte-ignore state_referenced_locally
	let actualSide: MenuSide = $state(side);
	let wasOpen = false;
	let closeRequested = false;
	let dismissedFromOutside = false;
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
		const triggerRect = anchorRect(trigger);
		if (matchAnchorWidth) {
			panelEl.style.width = `${triggerRect.width}px`;
		}
		const position = calculatePosition(triggerRect, layoutRect(panelEl), {
			side,
			align,
			sideOffset: offset,
			alignOffset,
			preventFlip,
			viewportPadding,
		});
		panelEl.style.top = `${position.top}px`;
		panelEl.style.left = `${position.left}px`;
		panelEl.style.transformOrigin = transformOriginFor(position.actualSide, align);
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
		restoreFocus: () => restoreFocusToAnchor && !dismissedFromOutside,
		canRestore: () => !open,
		focusReturn: getOverlayFocusReturn(),
	});

	function requestClose(): void {
		if (closeRequested) return;
		closeRequested = true;
		onclose();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (!open || event.defaultPrevented) return;
		roving.handleArrowKeys(event);
	}

	function onDocumentPointerDown(event: PointerEvent): void {
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
			dismissedFromOutside = true;
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
			const rect = anchorRect(trigger);
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
		dismissedFromOutside = false;
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
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		const releaseEscape = closeOnEscape ? registerEscapeScope(requestClose) : null;
		if (keyboardNavigation) document.addEventListener('keydown', onKeydown);
		document.addEventListener('scroll', positionCard, true);
		window.addEventListener('resize', positionCard);
		return () => {
			resizeObserver.disconnect();
			if (triggerFollowRaf !== null) cancelAnimationFrame(triggerFollowRaf);
			triggerFollowRaf = null;
			lastAnchorRect = null;
			releaseEscape?.();
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
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
			<div class="pointer-events-auto fixed inset-0 z-0" data-overlay-backdrop></div>
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
			out:menuClose|global={{ side: actualSide, align }}
		>
			{@render children()}
		</div>
	</div>
{/if}
