<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { TransitionConfig } from 'svelte/transition';
	import type { ClassValue } from 'svelte/elements';
	import {
		announceExclusiveOverlayOpen,
		bodyPortal,
		menuClose,
		menuOpen,
		overlaySurface,
		resolveOverlayZIndex,
	} from '../../overlay';

	interface Props {
		open: boolean;
		x: number;
		y: number;
		onclose: () => void;
		label: string;
		children: Snippet<[() => void]>;
		class?: ClassValue;
		panelClass?: ClassValue;
		viewportPadding?: number;
		anchor?: HTMLElement | null;
		testId?: string;
		backdropTestId?: string;
		owner?: string;
	}

	let {
		open,
		x,
		y,
		onclose,
		label,
		children,
		class: className,
		panelClass,
		viewportPadding = 8,
		anchor = null,
		testId,
		backdropTestId,
		owner,
	}: Props = $props();

	let panel: HTMLDivElement | null = $state(null);
	let coords = $state({ top: 0, left: 0 });
	let measured = $state(false);
	let resolvedSide = $state<'bottom' | 'top'>('bottom');
	let skipExit = false;
	let wasOpen = false;
	const zIndex = $derived(resolveOverlayZIndex(anchor));

	function measurePosition(): void {
		if (!open || !panel) return;
		const rect = panel.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		let left = x;
		let top = y;

		if (left + rect.width + viewportPadding > viewportWidth) {
			left = Math.max(viewportPadding, viewportWidth - rect.width - viewportPadding);
		}

		if (left < viewportPadding) {
			left = viewportPadding;
		}

		let side: 'bottom' | 'top' = 'bottom';

		if (top + rect.height + viewportPadding > viewportHeight) {
			top = Math.max(viewportPadding, viewportHeight - rect.height - viewportPadding);
			side = 'top';
		}

		if (top < viewportPadding) {
			top = viewportPadding;
		}

		coords = { top, left };
		resolvedSide = side;
		measured = true;
	}

	function restoreAnchorFocus(): void {
		if (anchor?.isConnected) anchor.focus({ preventScroll: true });
	}

	$effect(() => {
		if (!open) {
			measured = false;
			if (wasOpen) {
				wasOpen = false;
				void restoreAfterTick();
			}
			return;
		}

		wasOpen = true;
		announceExclusiveOverlayOpen();
		let resizeObserver: ResizeObserver | null = null;

		void focusPanelAfterTick(() => {
			if (!open || !panel) return;
			measurePosition();

			panel.focus();
			resizeObserver = new ResizeObserver(measurePosition);
			resizeObserver.observe(panel);
			if (anchor) resizeObserver.observe(anchor);
		});

		return () => resizeObserver?.disconnect();
	});

	async function restoreAfterTick(): Promise<void> {
		await tick();
		restoreAnchorFocus();
	}

	async function focusPanelAfterTick(onMeasured: () => void): Promise<void> {
		await tick();
		onMeasured();
	}

	$effect(() => {
		window.addEventListener('resize', measurePosition);
		window.addEventListener('scroll', measurePosition, true);
		return () => {
			window.removeEventListener('resize', measurePosition);
			window.removeEventListener('scroll', measurePosition, true);
		};
	});

	function panelOpen(node: HTMLElement): TransitionConfig {
		measurePosition();
		return menuOpen(node, { side: resolvedSide, align: 'center' });
	}

	function panelClose(node: HTMLElement): TransitionConfig {
		const skip = skipExit;
		skipExit = false;
		return menuClose(node, { side: resolvedSide, align: 'center', skip });
	}

	function closeFromItem(): void {
		skipExit = true;
		onclose();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
		}
	}

	function closeFromBackdrop(event: PointerEvent): void {
		event.preventDefault();
		onclose();
	}
</script>

{#if open}
	<div
		class="pointer-events-none fixed inset-0"
		style:z-index={zIndex}
		data-overlay-layer
		data-overlay-owner={owner}
		use:bodyPortal
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="presentation"
			class="pointer-events-auto fixed inset-0 z-0 cursor-default bg-transparent"
			data-overlay-backdrop
			data-popover-backdrop
			data-testid={backdropTestId}
			onpointerdown={closeFromBackdrop}
			oncontextmenu={(event) => {
				event.preventDefault();
				onclose();
			}}
		></div>
		<div
			bind:this={panel}
			class={[
				'shadow-popup pointer-events-auto fixed z-[1] min-w-44 py-1',
				panelClass ??
					'border-surface-elevated-border bg-surface-elevated rounded-lg border-[0.5px]',
				measured ? 'visible' : 'invisible',
				className,
			]}
			style:top="{coords.top}px"
			style:left="{coords.left}px"
			role="dialog"
			aria-label={label}
			tabindex="-1"
			data-dropdown-portal
			use:overlaySurface={{ anchored: true }}
			data-side={resolvedSide}
			data-testid={testId}
			onkeydown={onKeydown}
			in:panelOpen
			out:panelClose
		>
			{@render children(closeFromItem)}
		</div>
	</div>
{/if}
