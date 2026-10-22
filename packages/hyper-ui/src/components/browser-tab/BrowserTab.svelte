<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide, type SlideParams, type TransitionConfig } from 'svelte/transition';
	import Button from '../button/Button.svelte';
	import IconButton from '../icon-button/IconButton.svelte';
	import RenameText from '../rename-text/RenameText.svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { BusyIcon, Icon } from '../../icons';

	type BrowserTabSurface = 'panel' | 'band';
	type BrowserTabTone = 'neutral' | 'brand';
	type DataAttributes = Readonly<Record<`data-${string}`, string | undefined>>;

	interface Props {
		label: string;
		selected: boolean;
		closeLabel: string;
		icon?: Snippet | undefined;
		onclose?: ((event: MouseEvent) => void) | undefined;
		onselect?: (event: MouseEvent) => void;
		oncontextmenu?: ((event: MouseEvent) => void) | undefined;
		trailing?: Snippet | undefined;
		surface?: BrowserTabSurface;
		tone?: BrowserTabTone;
		href?: string | undefined;
		tabId?: string;
		tabindex?: number;
		ariaControls?: string | undefined;
		ariaCurrent?: 'page' | undefined;
		disabled?: boolean;
		closeDisabled?: boolean;
		tooltipPlacement?: 'top' | 'bottom';
		tabAttributes?: DataAttributes;
		closeAttributes?: DataAttributes;
		preview?: boolean;
		busy?: boolean;
		backgroundBusy?: boolean;
		description?: string | undefined;
		tooltip?: string | undefined;
		onpin?: () => void;
		shimmerRename?: boolean;
		isClosing?: (() => boolean) | undefined;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		label,
		selected,
		closeLabel,
		icon,
		onclose,
		onselect,
		oncontextmenu,
		trailing,
		surface = 'panel',
		tone = 'neutral',
		href,
		tabId,
		tabindex,
		ariaControls,
		ariaCurrent,
		disabled = false,
		closeDisabled = false,
		tooltipPlacement = 'bottom',
		tabAttributes = {},
		closeAttributes = {},
		preview = false,
		busy = false,
		backgroundBusy = false,
		description,
		tooltip,
		onpin,
		shimmerRename = false,
		isClosing,
		...rest
	}: Props = $props();

	const descriptionId = $props.id();
	let labelOverflow = $state(0);

	const observeLabelOverflow: Attachment<HTMLElement> = (text) => {
		const box = text.parentElement;
		if (!box) return;
		const observer = new ResizeObserver(() => {
			labelOverflow = text.offsetWidth - box.clientWidth;
		});
		observer.observe(text);
		observer.observe(box);
		return () => observer.disconnect();
	};

	const labelWidthClass: Record<BrowserTabSurface, string> = {
		panel: 'max-w-[13ch]',
		band: 'max-w-[24ch]',
	};

	const selectedClass: Record<BrowserTabSurface, string> = {
		panel: 'bg-surface-50-selected text-fg-default',
		band: 'text-fg-default',
	};

	const idleClass: Record<BrowserTabSurface, string> = {
		panel: 'text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-secondary',
		band: 'text-fg-tertiary hover:text-fg-secondary',
	};

	const closeHoverClass: Record<BrowserTabSurface, string> = {
		panel:
			'hover:bg-surface-50-selected group-data-[selected=true]/browser-tab:hover:bg-surface-100-selected',
		band: 'hover:bg-tab-hover',
	};

	const tabLink = $derived({
		...(href === undefined ? {} : { href }),
		...(tabId === undefined ? {} : { id: tabId }),
		...(tabindex === undefined ? {} : { tabindex }),
		...(ariaControls === undefined ? {} : { ariaControls }),
		...(ariaCurrent === undefined ? {} : { ariaCurrent }),
		...(onselect === undefined ? {} : { onclick: onselect }),
		...(onpin === undefined ? {} : { ondblclick: onpin, onkeydown: pinOnEnter }),
		...(description === undefined ? {} : { ariaDescribedby: descriptionId }),
	});

	function pinOnEnter(event: KeyboardEvent): void {
		if (event.key === 'Enter') onpin?.();
	}

	const brandClass: Record<BrowserTabSurface, string> = {
		panel: 'bg-brand/10 text-brand-foreground',
		band: 'text-brand-foreground',
	};

	const hiddenUnderCloseClass =
		'transition-opacity group-hover/browser-tab:opacity-0 group-has-[:focus-visible]/browser-tab:opacity-0 motion-reduce:transition-none';

	const motion = (): TransitionConfig => ({
		duration: prefersReducedMotion.current ? 0 : 180,
		easing: cubicOut,
	});

	const slotMotion = (): SlideParams => ({ axis: 'x', ...motion() });

	// ponytail: a click on close counts for a second, so a close slower than that skips the collapse
	const CLOSE_CLICK_MS = 1000;
	let closeClickedAt = -Infinity;

	function close(event: MouseEvent): void {
		closeClickedAt = performance.now();
		onclose?.(event);
	}

	function stripGap(node: HTMLElement): number {
		const strip = node.parentElement;
		if (!strip) return 0;
		const style = getComputedStyle(strip);
		return style.display === 'contents' ? stripGap(strip) : parseFloat(style.columnGap) || 0;
	}

	function collapse(node: HTMLElement): TransitionConfig {
		const closeClicked = performance.now() - closeClickedAt < CLOSE_CLICK_MS;
		if (!(closeClicked || isClosing?.())) return { duration: 0 };
		const width = node.getBoundingClientRect().width;
		const gap = stripGap(node);
		return {
			...motion(),
			css: (t) =>
				`flex: none; overflow: hidden; min-width: 0; width: ${t * width}px; margin-inline-end: ${(t - 1) * gap}px; opacity: ${t};`,
		};
	}

	const surfaceClass = $derived(
		tone === 'brand' ? brandClass[surface] : selected ? selectedClass[surface] : idleClass[surface],
	);
</script>

<div
	class={[
		'browser-tab group/browser-tab has-[[role=tab]:focus-visible]:ring-button-primary/40 flex h-7 items-center rounded-md transition-[color,border-color] has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset motion-reduce:transition-none',
		surface === 'band'
			? 'band-tab relative max-w-max min-w-16 flex-1'
			: 'relative min-w-0 shrink-0 overflow-hidden',
		surfaceClass,
	]}
	data-selected={selected}
	{...rest}
	{oncontextmenu}
	out:collapse|global
>
	{#if tooltip}
		<Tooltip
			content={tooltip}
			placement={tooltipPlacement}
			onlyWhenTruncated={tooltip === label}
			class="h-full min-w-0"
		>
			{@render tab()}
		</Tooltip>
	{:else}
		{@render tab()}
	{/if}
	{#if description !== undefined}
		<span id={descriptionId} hidden>{description}</span>
	{/if}
	{#if onclose}
		<Tooltip
			content={closeLabel}
			placement={tooltipPlacement}
			class="absolute inset-y-0 right-1 flex items-center"
		>
			<IconButton
				bare
				ariaLabel={closeLabel}
				disabled={closeDisabled}
				class={[
					'focus-visible:ring-button-primary/40 relative grid size-5 shrink-0 translate-x-1.5 cursor-pointer place-items-center rounded-sm opacity-0 transition-[opacity,color,translate] duration-150 ease-out outline-none group-hover/browser-tab:translate-x-0 group-hover/browser-tab:opacity-100 group-has-[:focus-visible]/browser-tab:translate-x-0 group-has-[:focus-visible]/browser-tab:opacity-100 before:absolute before:-inset-1 before:content-[""] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none',
					tone === 'brand' ? 'text-brand/70' : 'text-fg-tertiary hover:text-fg-default',
					closeHoverClass[surface],
				]}
				onclick={close}
				{...closeAttributes}
			>
				<Icon name="close" size={14} />
			</IconButton>
		</Tooltip>
	{/if}
</div>

{#snippet tab()}
	<Button
		bare
		role="tab"
		ariaSelected={selected}
		{disabled}
		class={[
			'flex h-full min-w-0 cursor-pointer items-center px-2 py-0 text-xs font-medium outline-none disabled:cursor-not-allowed',
		]}
		{...tabLink}
		{...tabAttributes}
	>
		{#if busy || backgroundBusy || icon}
			<span
				class={[
					'mr-1 -ml-0.5 grid h-4 w-4 shrink-0 place-items-center',
					busy && !selected && 'text-fg-secondary',
				]}
				aria-hidden={busy || backgroundBusy ? 'true' : undefined}
				transition:slide={slotMotion()}
			>
				{#if busy || backgroundBusy}
					<BusyIcon size={12} background={!busy} />
				{:else if icon}
					{@render icon()}
				{/if}
			</span>
		{/if}
		<RenameText
			text={label}
			shimmer={shimmerRename}
			class={[
				'tab-label min-w-0',
				labelWidthClass[surface],
				preview && 'pr-0.5 italic',
				busy && !selected && 'text-fg-secondary',
				onclose && !trailing && 'tab-label-faded',
			]}
			textClass="tab-label-text"
			textAttach={observeLabelOverflow}
			style={`--tab-label-overflow: ${labelOverflow}`}
			data-overflowing={labelOverflow > 0 ? 'true' : undefined}
		/>
		{#if trailing && onclose}
			<span
				class={[
					surface === 'band' ? 'grid h-4 w-4 place-items-center' : 'flex',
					'ml-1 shrink-0',
					hiddenUnderCloseClass,
				]}
				transition:slide={slotMotion()}
			>
				{@render trailing()}
			</span>
		{:else if trailing}
			<span class="ml-1 flex shrink-0" transition:slide={slotMotion()}>
				{@render trailing()}
			</span>
		{/if}
	</Button>
{/snippet}

<style>
	:global(.band-tab) + .band-tab::before {
		content: '';
		position: absolute;
		inset-block: 8px;
		left: -1px;
		border-left: 1px solid var(--color-border-subtle);
		transition: opacity 180ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	:global(.band-tab[inert]:not(.band-tab + .band-tab)) + .band-tab::before {
		opacity: 0;
	}

	.browser-tab :global(.tab-label-text) {
		display: inline-block;
		vertical-align: top;
	}

	.browser-tab :global(.tab-label:is([data-overflowing], [data-renaming])) {
		--tab-label-fade: 20;
		mask-image: linear-gradient(
			to left,
			transparent,
			black calc(var(--tab-label-fade) * var(--rename-overflow, 1) * 1px)
		);
	}

	.browser-tab:is(:hover, :has(:global(:focus-visible)), [inert]) :global(.tab-label-faded) {
		--tab-label-fade: 26;
		mask-image: linear-gradient(to left, transparent 16px, black calc(var(--tab-label-fade) * 1px));
	}

	.browser-tab:is(:hover, [inert])
		:global(.tab-label[data-overflowing]:not([data-renaming]) > .tab-label-text) {
		--tab-label-shift: calc(var(--tab-label-overflow) + var(--tab-label-fade));
		transform: translateX(calc(var(--tab-label-shift) * -1px));
		transition: transform calc(var(--tab-label-shift) * 20ms) linear 300ms;
	}

	@media (prefers-reduced-motion: reduce) {
		.browser-tab:is(:hover, [inert]) :global(.tab-label[data-overflowing] > .tab-label-text) {
			transition-duration: 0s;
		}
	}
</style>
