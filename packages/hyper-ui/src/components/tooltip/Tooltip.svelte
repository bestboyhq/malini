<script module lang="ts">
	let nextTooltipId = 0;
</script>

<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import { tick, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { on } from 'svelte/events';

	import { observeViewportReposition } from '../../overlay/viewport-reposition-observer';

	import { getShowDelay, markTooltipDismissed } from './tooltip-warmup';
	import { claimHoverTooltip, releaseHoverTooltip } from './tooltip-exclusivity';
	import {
		bodyPortal,
		isExclusiveOverlayActive,
		onExclusiveOverlayOpen,
		overlaySurface,
		resolveOverlayZIndex,
	} from '../../overlay';

	type SnippetWithClose = (close: () => void) => ReturnType<Snippet>;
	type Placement = 'top' | 'bottom' | 'left' | 'right';
	type Align = 'left' | 'center' | 'right' | 'top' | 'bottom';
	type Trigger = 'hover' | 'click';

	interface Props {
		content: string | Snippet<[() => void]> | SnippetWithClose;
		placement?: Placement;
		children: Snippet;
		class?: ClassValue;
		trigger?: Trigger;
		interactive?: boolean;
		align?: Align;
		offset?: number;
		viewportPadding?: number;
		closeOnOutsideTooltipClick?: boolean;
		suppressed?: boolean;
	}

	const {
		children,
		class: className,
		content,
		placement = 'bottom',
		trigger = 'hover',
		interactive = false,
		align = 'center',
		offset = 8,
		viewportPadding = 8,
		closeOnOutsideTooltipClick = false,
		suppressed = false,
	}: Props = $props();

	const TRANSITION_DURATION = 160;
	const EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

	let wrapper: HTMLSpanElement;
	let tooltip: HTMLDivElement | null = $state(null);
	const tooltipId = `hyper-tooltip-${++nextTooltipId}`;
	let describedElement: HTMLElement | null = null;

	let visible = $state(false);
	let positioned = $state(false);
	let shown = $state(false);
	let armed = $state(false);
	let coords = $state({ top: 0, left: 0 });
	let activePlacement = $state<Placement>('bottom');
	let tooltipZIndex = $state(1_000);
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;
	let showTimeout: ReturnType<typeof setTimeout> | null = null;
	let unmountTimeout: ReturnType<typeof setTimeout> | null = null;
	let entranceRaf: number | null = null;
	let interactiveListenersAttached = false;
	let resizeObserver: ResizeObserver | null = null;

	function teardownTooltipNode(): void {
		unlinkFocusedTrigger();
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (tooltip && trigger === 'hover' && interactiveListenersAttached) {
			tooltip.removeEventListener('mouseenter', show);
			tooltip.removeEventListener('mouseleave', hide);
			interactiveListenersAttached = false;
		}
	}

	function cancelPendingEntrance(): void {
		if (entranceRaf !== null) {
			cancelAnimationFrame(entranceRaf);
			entranceRaf = null;
		}
	}

	function show(): void {
		if (suppressed || isExclusiveOverlayActive(wrapper)) return;
		if (trigger === 'hover') claimHoverTooltip(hideImmediate);
		linkFocusedTrigger();
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		if (unmountTimeout) {
			clearTimeout(unmountTimeout);
			unmountTimeout = null;
		}
		if (visible && shown) return;
		if (visible && !shown) {
			cancelPendingEntrance();
			armed = true;
			shown = true;
			return;
		}

		const startShow = async (): Promise<void> => {
			if (suppressed || isExclusiveOverlayActive(wrapper)) {
				hideImmediate();
				return;
			}
			tooltipZIndex = resolveOverlayZIndex(wrapper);
			visible = true;
			positioned = false;
			shown = false;
			armed = false;
			await tick();
			if (!visible) return;
			positionTooltip();
			positioned = true;
			cancelPendingEntrance();
			entranceRaf = requestAnimationFrame(() => {
				armed = true;
				entranceRaf = requestAnimationFrame(() => {
					entranceRaf = null;
					shown = true;
				});
			});
		};

		if (trigger === 'hover') {
			if (showTimeout) return;
			showTimeout = setTimeout(() => {
				showTimeout = null;
				void startShow();
			}, getShowDelay());
		} else {
			void startShow();
		}
	}

	function hide(): void {
		if (showTimeout) {
			clearTimeout(showTimeout);
			showTimeout = null;
			if (!visible && trigger === 'hover') releaseHoverTooltip(hideImmediate);
		}
		if (!visible) return;

		const startExit = (): void => {
			cancelPendingEntrance();
			shown = false;
			if (unmountTimeout) clearTimeout(unmountTimeout);
			unmountTimeout = setTimeout(() => {
				unmountTimeout = null;
				visible = false;
				positioned = false;
			}, TRANSITION_DURATION);
		};

		if (interactive && trigger === 'hover') {
			hideTimeout = setTimeout(() => {
				hideTimeout = null;
				startExit();
			}, 200);
		} else {
			startExit();
		}
	}

	function hideImmediate(): void {
		const wasMounted = visible;
		if (showTimeout) {
			clearTimeout(showTimeout);
			showTimeout = null;
		}
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		if (unmountTimeout) {
			clearTimeout(unmountTimeout);
			unmountTimeout = null;
		}
		cancelPendingEntrance();
		shown = false;
		visible = false;
		positioned = false;
		unlinkFocusedTrigger();
		if (trigger === 'hover') releaseHoverTooltip(hideImmediate);
		if (wasMounted) {
			wasVisible = false;
			markTooltipDismissed();
		}
	}

	function linkFocusedTrigger(): void {
		if (typeof content !== 'string') return;
		const focused = document.activeElement;
		if (!(focused instanceof HTMLElement) || !wrapper.contains(focused)) return;
		if (describedElement === focused) return;
		unlinkFocusedTrigger();
		const ids = new Set(
			(focused.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
		);
		ids.add(tooltipId);
		focused.setAttribute('aria-describedby', [...ids].join(' '));
		describedElement = focused;
	}

	function unlinkFocusedTrigger(): void {
		if (!describedElement) return;
		const ids = (describedElement.getAttribute('aria-describedby') ?? '')
			.split(/\s+/)
			.filter((id) => id && id !== tooltipId);
		if (ids.length > 0) {
			describedElement.setAttribute('aria-describedby', ids.join(' '));
		} else {
			describedElement.removeAttribute('aria-describedby');
		}
		describedElement = null;
	}

	function toggle(): void {
		if (visible && shown) {
			hide();
		} else {
			show();
		}
	}

	function onTriggerClick(event: MouseEvent): void {
		if (trigger === 'click') {
			event.stopPropagation();
			toggle();
		}
	}

	function onTriggerFocusOut(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget)) return;
		unlinkFocusedTrigger();
		if (!wrapper.matches(':hover')) hide();
	}

	function onTriggerMouseLeave(): void {
		if (wrapper.contains(document.activeElement)) return;
		hide();
	}

	function onDocumentClick(event: MouseEvent): void {
		if (!(event.target instanceof Node)) return;
		if (
			trigger === 'click' &&
			visible &&
			tooltip &&
			!tooltip.contains(event.target) &&
			!wrapper.contains(event.target)
		) {
			const clickTarget = event.target;
			const allTooltips = document.querySelectorAll('[data-tooltip-portal]');
			const isInsideAnyTooltip = Array.from(allTooltips).some((tooltipEl) =>
				tooltipEl.contains(clickTarget),
			);

			if (closeOnOutsideTooltipClick) {
				hide();
			} else if (!isInsideAnyTooltip) {
				hide();
			}
		}
	}

	function onDocumentKeydown(event: KeyboardEvent): void {
		if (!visible || trigger !== 'click' || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		hideImmediate();
		wrapper
			.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')
			?.focus({ preventScroll: true });
	}

	function positionTooltip(): void {
		if (!tooltip || !wrapper) return;

		const triggerRect = wrapper.getBoundingClientRect();
		const tooltipWidth = tooltip.offsetWidth;
		const tooltipHeight = tooltip.offsetHeight;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const gap = offset;
		const edgePadding = viewportPadding;

		let top: number;
		let left: number;
		let effectivePlacement: Placement = placement;

		if (placement === 'left' || placement === 'right') {
			if (align === 'top') {
				top = triggerRect.top;
			} else if (align === 'bottom') {
				top = triggerRect.bottom - tooltipHeight;
			} else {
				top = triggerRect.top + (triggerRect.height - tooltipHeight) / 2;
			}

			left = placement === 'left' ? triggerRect.left - tooltipWidth - gap : triggerRect.right + gap;
		} else {
			top = placement === 'top' ? triggerRect.top - tooltipHeight - gap : triggerRect.bottom + gap;

			left = getAlignedLeft(triggerRect, tooltipWidth);
		}

		const minLeft = edgePadding;
		const maxLeft = viewportWidth - tooltipWidth - edgePadding;
		if (left < minLeft) {
			left = minLeft;
		} else if (left > maxLeft) {
			left = maxLeft;
		}

		const minTop = edgePadding;
		const maxTop = viewportHeight - tooltipHeight - edgePadding;
		if (top < minTop) {
			top = triggerRect.bottom + gap;
			if (placement === 'top') effectivePlacement = 'bottom';
		} else if (top > maxTop) {
			top = triggerRect.top - tooltipHeight - gap;
			if (placement === 'bottom') effectivePlacement = 'top';
		}

		top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));

		coords = { top, left };
		activePlacement = effectivePlacement;

		if (trigger === 'hover' && interactive && !interactiveListenersAttached) {
			tooltip.addEventListener('mouseenter', show);
			tooltip.addEventListener('mouseleave', hide);
			interactiveListenersAttached = true;
		}

		if (!resizeObserver) {
			resizeObserver = new ResizeObserver(positionTooltip);
			resizeObserver.observe(wrapper);
			resizeObserver.observe(tooltip);
		}
	}

	$effect(() => {
		return onExclusiveOverlayOpen(() => {
			if (
				wrapper.closest('[data-dropdown-portal], [data-hovercard-portal], [data-overlay-portal]')
			) {
				return;
			}
			hideImmediate();
		});
	});

	$effect(() => {
		const listeners =
			trigger === 'hover'
				? [
						on(wrapper, 'mouseenter', show),
						on(wrapper, 'mouseleave', onTriggerMouseLeave),
						on(wrapper, 'focusin', show),
						on(wrapper, 'focusout', onTriggerFocusOut),
						on(wrapper, 'pointerdown', hideImmediate),
					]
				: [
						on(wrapper, 'click', onTriggerClick),
						on(document, 'click', onDocumentClick),
						on(document, 'keydown', onDocumentKeydown),
					];

		return () => {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
				hideTimeout = null;
			}
			if (showTimeout) {
				clearTimeout(showTimeout);
				showTimeout = null;
			}
			if (unmountTimeout) {
				clearTimeout(unmountTimeout);
				unmountTimeout = null;
			}
			cancelPendingEntrance();
			for (const removeListener of listeners) removeListener();
		};
	});

	$effect(() => {
		if (suppressed) hideImmediate();
	});

	$effect(() => {
		if (!visible) return;

		return observeViewportReposition(() => {
			if (visible && tooltip) {
				positionTooltip();
			}
		});
	});

	$effect(() => {
		if (!visible) {
			teardownTooltipNode();
		}
	});

	let wasVisible = false;
	$effect(() => {
		if (visible) {
			wasVisible = true;
		} else if (wasVisible) {
			markTooltipDismissed();
			if (trigger === 'hover') releaseHoverTooltip(hideImmediate);
			wasVisible = false;
		}
	});

	$effect(() => {
		return () => {
			releaseHoverTooltip(hideImmediate);
			teardownTooltipNode();
		};
	});

	const reducedMotion = $derived(
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	);

	const transformOrigin = $derived(transformOriginForPlacement(activePlacement));

	const closedTransform = $derived(
		reducedMotion ? 'none' : closedTransformForPlacement(activePlacement),
	);

	const animationStyle = $derived.by(() => {
		const transition = !armed
			? 'none'
			: reducedMotion
				? `opacity ${TRANSITION_DURATION}ms ${EASING}`
				: `opacity ${TRANSITION_DURATION}ms ${EASING}, transform ${TRANSITION_DURATION}ms ${EASING}`;
		if (shown) {
			return `opacity: 1; transform: none; transform-origin: ${transformOrigin}; transition: ${transition};`;
		}
		return `opacity: 0; transform: ${closedTransform}; transform-origin: ${transformOrigin}; transition: ${transition};`;
	});

	const positionStyle = $derived(
		`position: fixed; top: ${coords.top}px; left: ${coords.left}px; z-index: ${tooltipZIndex};`,
	);
	const visibilityStyle = $derived(positioned ? '' : 'visibility: hidden;');
	const pointerEventsStyle = $derived(`pointer-events: ${interactive ? 'auto' : 'none'};`);
	const isSnippetContent = $derived(typeof content === 'function');

	function getAlignedLeft(triggerRect: DOMRect, tooltipWidth: number): number {
		if (align === 'left') {
			return triggerRect.left;
		}
		if (align === 'right') {
			return triggerRect.right - tooltipWidth;
		}
		return triggerRect.left + (triggerRect.width - tooltipWidth) / 2;
	}

	function transformOriginForPlacement(value: Placement): string {
		if (value === 'top') {
			return 'center bottom';
		}
		if (value === 'bottom') {
			return 'center top';
		}
		if (value === 'left') {
			return 'right center';
		}
		return 'left center';
	}

	function closedTransformForPlacement(value: Placement): string {
		if (value === 'top') {
			return 'translateY(6px) scale(0.96)';
		}
		if (value === 'bottom') {
			return 'translateY(-6px) scale(0.96)';
		}
		if (value === 'left') {
			return 'translateX(6px) scale(0.96)';
		}
		return 'translateX(-6px) scale(0.96)';
	}
</script>

<span
	class={['flex', className]}
	bind:this={wrapper}
	data-tooltip-trigger
	data-tooltip-content={typeof content === 'string' ? content : undefined}
>
	{@render children()}
</span>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role={isSnippetContent ? 'group' : 'tooltip'}
		id={tooltipId}
		bind:this={tooltip}
		data-tooltip-portal
		use:overlaySurface={{ anchored: true }}
		data-placement={activePlacement}
		class={[
			'shadow-popup wrap-break-word whitespace-normal select-none',
			isSnippetContent
				? 'p-1'
				: 'border-surface-tooltip-border bg-surface-tooltip text-fg-default w-max max-w-xs rounded-lg border-[0.5px] px-2.5 py-1.5 text-center text-xs leading-tight font-normal',
		]}
		style="{positionStyle} {pointerEventsStyle} {visibilityStyle} {animationStyle}"
		onclick={(event) => event.stopPropagation()}
		use:bodyPortal
	>
		{#if typeof content === 'function'}
			{@render content(() => {
				setTimeout(() => {
					hide();
				});
			})}
		{:else}
			<SensitiveText text={content} />
		{/if}
	</div>
{/if}
