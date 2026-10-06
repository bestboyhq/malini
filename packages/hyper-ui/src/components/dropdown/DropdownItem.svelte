<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { getMenuSurfaceContext, getMenuTreeContext } from './menu-tree.svelte';

	type Variant = 'default' | 'danger';
	type Props = Omit<HTMLButtonAttributes, 'children' | 'onselect'> & {
		selected?: boolean;
		onSelect?: () => void;
		closeOnSelect?: boolean;
		focusOnHover?: boolean;
		children: Snippet;
		variant?: Variant;
	};

	let {
		selected = false,
		onSelect,
		closeOnSelect = true,
		focusOnHover = true,
		children,
		class: className,
		variant = 'default',
		onclick,
		onmouseenter,
		...rest
	}: Props = $props();

	const surface = getMenuSurfaceContext();
	const tree = getMenuTreeContext();

	function commit(): void {
		onSelect?.();
		if (closeOnSelect) tree?.closeAll(true);
	}

	function handleClick(
		event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement },
	): void {
		onclick?.(event);
		if (event.defaultPrevented || rest.disabled) return;
		commit();
	}

	function handleMouseEnter(
		event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement },
	): void {
		onmouseenter?.(event);
		if (event.defaultPrevented || focusOnHover === false || rest.disabled) return;
		if (surface?.isInSafeArea(event.clientX, event.clientY)) return;
		event.currentTarget.focus({ preventScroll: true });
		surface?.closeAllChildren();
	}
</script>

<button
	{...rest}
	type={rest.type ?? 'button'}
	class={[
		'flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors outline-none',
		variant === 'danger' ? 'text-error-content' : 'text-fg-secondary',
		variant === 'danger'
			? 'hover:bg-error/10 focus:bg-error/10'
			: selected
				? undefined
				: 'hover:bg-surface-elevated-hover hover:text-fg-default focus:bg-surface-elevated-hover focus:text-fg-default',
		selected && variant === 'default' && 'bg-surface-elevated-selected text-fg-default',
		className,
	]}
	onclick={handleClick}
	onmouseenter={handleMouseEnter}
>
	{@render children()}
</button>
