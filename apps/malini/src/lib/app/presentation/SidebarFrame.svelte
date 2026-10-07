<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { sidebarGeometry } from './sidebar-geometry';
	import { hydrateSidebarCommand } from '$lib/app/application/commands/hydrate-sidebar.command';
	import { resetSidebarWidthCommand } from '$lib/app/application/commands/reset-sidebar-width.command';
	import { resizeSidebarCommand } from '$lib/app/application/commands/resize-sidebar.command';
	import { holdSidebarPresenceHook } from '$lib/app/application/hooks/hold-sidebar-presence.hook';
	import { sidebarCollapsedQuery } from '$lib/app/application/queries/sidebar-collapsed.query.svelte';
	import { sidebarWidthQuery } from '$lib/app/application/queries/sidebar-width.query.svelte';
	import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '$lib/app/domain/sidebar-width';

	interface Props {
		children: Snippet;
		lead?: Snippet;
		class?: ClassValue;
		testId?: string;
		[key: string]: unknown;
	}

	let { children, lead, class: className, testId, ...rest }: Props = $props();

	const width = $derived(sidebarWidthQuery.data);
	const collapsed = $derived(sidebarCollapsedQuery.data);

	let drag: { pointerId: number; startX: number; startWidth: number } | null = null;

	onMount(() => {
		hydrateSidebarCommand();
		return holdSidebarPresenceHook();
	});

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 && event.pointerType === 'mouse') return;
		event.preventDefault();
		const target = event.currentTarget;
		if (!(target instanceof HTMLButtonElement)) return;
		target.setPointerCapture(event.pointerId);
		drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		resizeSidebarCommand(drag.startWidth + (event.clientX - drag.startX), false);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const target = event.currentTarget;
		if (target instanceof HTMLButtonElement && target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
		resizeSidebarCommand(width, true);
		drag = null;
	}

	function onKeyDown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 16 : 1;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			resizeSidebarCommand(width - step, true);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			resizeSidebarCommand(width + step, true);
		} else if (event.key === 'Home') {
			event.preventDefault();
			resizeSidebarCommand(SIDEBAR_MIN_WIDTH, true);
		} else if (event.key === 'End') {
			event.preventDefault();
			resizeSidebarCommand(SIDEBAR_MAX_WIDTH, true);
		}
	}
</script>

{#if !collapsed}
	<aside
		use:sidebarGeometry
		class={['bg-surface-50 flex h-full min-w-0 shrink-0 flex-col overflow-hidden', className]}
		style:width={`${width}px`}
		data-testid={testId}
		{...rest}
	>
		<div class="shell-sidebar-band"></div>

		{#if lead}
			{@render lead()}
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			{@render children()}
		</div>
	</aside>
{/if}

{#if !collapsed}
	<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
	<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- drag handle: Button now forwards `role`, but not `aria-orientation`, not `aria-valuemin/max/now`, and not the pointer-capture or double-click handlers this control is made of; a separator that cannot report its own value is not this control. -->
	<button
		type="button"
		role="separator"
		aria-orientation="vertical"
		aria-valuemin={SIDEBAR_MIN_WIDTH}
		aria-valuemax={SIDEBAR_MAX_WIDTH}
		aria-valuenow={Math.round(width)}
		aria-label="Resize sidebar"
		tabindex="0"
		class="shell-sidebar-handle"
		data-testid="shell-sidebar-resize-handle"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		ondblclick={resetSidebarWidthCommand}
		onkeydown={onKeyDown}
	></button>
{/if}

<style>
	.shell-sidebar-band {
		flex-shrink: 0;
		height: var(--native-titlebar-safe-area);
	}

	.shell-sidebar-handle {
		position: relative;
		display: block;
		height: 100%;
		width: 8px;
		flex-shrink: 0;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: col-resize;
		touch-action: none;
	}

	.shell-sidebar-handle::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 1px;
		background: var(--color-surface-50-border);
	}

	.shell-sidebar-handle:hover::after,
	.shell-sidebar-handle:focus-visible::after {
		background: var(--color-fg-tertiary);
	}

	.shell-sidebar-handle:focus-visible {
		outline: none;
	}
</style>
