<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import DropdownLayer from '../dropdown-layer/DropdownLayer.svelte';
	import {
		createMenuSurface,
		createMenuTree,
		setMenuSurfaceContext,
		setMenuTreeContext,
	} from './menu-tree.svelte';
	import type { MenuAlign, MenuSide } from '../../overlay';

	interface Props {
		open?: boolean;
		side?: MenuSide;
		align?: MenuAlign;
		sideOffset?: number;
		alignOffset?: number;
		fullWidth?: boolean;
		preventFlip?: boolean;
		interactiveTrigger?: boolean;
		keyboardNavigation?: boolean;
		onOpenChange?: (open: boolean) => void;
		trigger: Snippet;
		content: Snippet;
		panelClass?: ClassValue;
		contentClass?: ClassValue;
		testId?: string;
		owner?: string;
	}

	let {
		open = $bindable(false),
		side = 'bottom',
		align = 'start',
		sideOffset = 8,
		alignOffset = 0,
		fullWidth = false,
		preventFlip = false,
		interactiveTrigger = true,
		keyboardNavigation = true,
		onOpenChange,
		trigger,
		content,
		panelClass = '',
		contentClass = 'max-h-[400px] overflow-y-auto p-1.5',
		testId,
		owner,
	}: Props = $props();

	let triggerWrapper: HTMLDivElement | null = $state(null);
	const surface = createMenuSurface();
	const tree = createMenuTree(close);
	setMenuSurfaceContext(surface);
	setMenuTreeContext(tree);

	function setOpen(next: boolean): void {
		if (open === next) return;
		open = next;
		onOpenChange?.(next);
	}

	function openDropdown(): void {
		if (!interactiveTrigger || open) return;
		setOpen(true);
	}

	function close(): void {
		surface.closeAllChildren();
		setOpen(false);
	}

	function toggle(): void {
		if (open) close();
		else openDropdown();
	}

	function onTriggerClick(): void {
		if (!interactiveTrigger) return;
		toggle();
	}
</script>

{#if interactiveTrigger}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={triggerWrapper}
		class={['inline-flex min-w-0', fullWidth && 'flex w-full']}
		data-hyper-dropdown-trigger
		data-state={open ? 'open' : 'closed'}
		onclick={onTriggerClick}
	>
		{@render trigger()}
	</div>
{:else}
	<div
		bind:this={triggerWrapper}
		class="pointer-events-none flex size-0 overflow-hidden"
		aria-hidden="true"
	>
		{@render trigger()}
	</div>
{/if}

<DropdownLayer
	{open}
	anchor={triggerWrapper}
	onclose={close}
	{side}
	{align}
	offset={sideOffset}
	{alignOffset}
	{preventFlip}
	matchAnchorWidth={fullWidth}
	{keyboardNavigation}
	panelClass={[
		'overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated',
		panelClass,
	]}
	{testId}
	{owner}
>
	<div class={contentClass} data-hyper-dropdown-content>
		{@render content()}
	</div>
</DropdownLayer>
