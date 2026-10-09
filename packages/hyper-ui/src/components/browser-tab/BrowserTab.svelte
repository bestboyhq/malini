<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Button from '../button/Button.svelte';
	import IconButton from '../icon-button/IconButton.svelte';
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
		onclose: (event: MouseEvent) => void;
		onselect?: (event: MouseEvent) => void;
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
		description?: string | undefined;
		tooltip?: string | undefined;
		onpin?: () => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		label,
		selected,
		closeLabel,
		icon,
		onclose,
		onselect,
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
		description,
		tooltip,
		onpin,
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

	const closeAnchorClass: Record<BrowserTabSurface, string> = {
		panel: '',
		band: 'absolute inset-y-0 right-2 items-center',
	};

	const closeRevealClass: Record<BrowserTabSurface, string> = {
		panel: 'mr-1 group-data-[selected=true]/browser-tab:opacity-100',
		band: '',
	};

	const tabPaddingClass = $derived(
		surface === 'band' ? (icon ? 'pr-2 pl-1.5' : 'px-2') : 'pr-0.5 pl-1.5',
	);

	const surfaceClass = $derived(
		tone === 'brand' ? brandClass[surface] : selected ? selectedClass[surface] : idleClass[surface],
	);
</script>

<div
	class={[
		'browser-tab group/browser-tab has-[[role=tab]:focus-visible]:ring-button-primary/40 flex h-7 items-center rounded-md transition-[color,border-color] has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset motion-reduce:transition-none',
		surface === 'band'
			? 'band-tab relative max-w-max min-w-16 flex-1'
			: 'min-w-0 shrink-0 overflow-hidden',
		surfaceClass,
	]}
	data-selected={selected}
	{...rest}
>
	{#if tooltip}
		<Tooltip content={tooltip} placement={tooltipPlacement} class="h-full min-w-0">
			{@render tab()}
		</Tooltip>
	{:else}
		{@render tab()}
	{/if}
	{#if description !== undefined}
		<span id={descriptionId} hidden>{description}</span>
	{/if}
	<Tooltip content={closeLabel} placement={tooltipPlacement} class={closeAnchorClass[surface]}>
		<IconButton
			bare
			ariaLabel={closeLabel}
			disabled={closeDisabled}
			class={[
				'focus-visible:ring-button-primary/40 relative grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-sm opacity-0 transition-[opacity,color] outline-none group-hover/browser-tab:opacity-100 before:absolute before:-inset-1 before:content-[""] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none',
				closeRevealClass[surface],
				tone === 'brand' ? 'text-brand/70' : 'text-fg-tertiary hover:text-fg-default',
				closeHoverClass[surface],
			]}
			onclick={onclose}
			{...closeAttributes}
		>
			<Icon name="close" size={8} />
		</IconButton>
	</Tooltip>
</div>

{#snippet tab()}
	<Button
		bare
		role="tab"
		ariaSelected={selected}
		{disabled}
		class={[
			'flex h-full min-w-0 cursor-pointer items-center gap-1 py-0 text-xs font-medium outline-none disabled:cursor-not-allowed',
			tabPaddingClass,
		]}
		{...tabLink}
		{...tabAttributes}
	>
		{#if icon}
			<span class="grid h-4 w-4 shrink-0 place-items-center">{@render icon()}</span>
		{/if}
		<span
			class={[
				'tab-label relative min-w-0 overflow-hidden whitespace-nowrap',
				labelWidthClass[surface],
				preview && 'italic',
				busy && !selected && 'text-fg-secondary',
				surface === 'band' && !trailing && 'tab-label-faded',
			]}
			data-overflowing={labelOverflow > 0 ? 'true' : undefined}
			style:--tab-label-overflow={labelOverflow}
		>
			<span class="tab-label-text" {@attach observeLabelOverflow}>
				<SensitiveText text={label} />
			</span>
			{#if busy}
				<span class="tab-shimmer" aria-hidden="true">
					<span class="tab-shimmer-band">
						<span class="tab-shimmer-text">
							<span class="tab-label-text"><SensitiveText text={label} /></span>
						</span>
					</span>
				</span>
			{/if}
		</span>
		{#if busy}
			<span
				class="hidden h-4 w-4 shrink-0 place-items-center motion-reduce:grid"
				aria-hidden="true"
			>
				<BusyIcon size={12} />
			</span>
		{/if}
		{#if trailing && surface === 'band'}
			<span
				class="grid h-4 w-4 shrink-0 place-items-center transition-opacity group-hover/browser-tab:opacity-0 motion-reduce:transition-none"
			>
				{@render trailing()}
			</span>
		{:else}
			{@render trailing?.()}
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
	}

	.tab-label-text {
		display: inline-block;
		vertical-align: top;
	}

	.tab-label[data-overflowing] {
		--tab-label-fade: 20;
		mask-image: linear-gradient(to left, transparent, black calc(var(--tab-label-fade) * 1px));
	}

	.browser-tab:hover .tab-label-faded {
		--tab-label-fade: 26;
		mask-image: linear-gradient(to left, transparent 16px, black calc(var(--tab-label-fade) * 1px));
	}

	.browser-tab:hover .tab-label[data-overflowing] .tab-label-text {
		--tab-label-shift: calc(var(--tab-label-overflow) + var(--tab-label-fade));
		transform: translateX(calc(var(--tab-label-shift) * -1px));
		transition: transform calc(var(--tab-label-shift) * 20ms) linear 300ms;
	}

	.tab-shimmer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.tab-shimmer-band {
		position: absolute;
		inset: 0;
		mask-image: linear-gradient(90deg, transparent 30%, black 50%, transparent 70%);
		animation: tab-shimmer-sweep 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	.tab-shimmer-text {
		display: block;
		color: var(--color-fg-default);
		animation: tab-shimmer-hold 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	.browser-tab[data-selected='true'] .tab-shimmer-text {
		color: var(--color-fg-secondary);
	}

	@keyframes tab-shimmer-sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(100%);
		}
	}

	@keyframes tab-shimmer-hold {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(-100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tab-shimmer {
			display: none;
		}

		.browser-tab:hover .tab-label[data-overflowing] .tab-label-text {
			transition-duration: 0s;
		}
	}
</style>
