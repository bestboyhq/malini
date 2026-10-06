<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import type { Snippet } from 'svelte';
	import Button from '../button/Button.svelte';
	import IconButton from '../icon-button/IconButton.svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { Icon } from '../../icons';

	type BrowserTabSurface = 'panel' | 'band';
	type BrowserTabTone = 'neutral' | 'brand';
	type DataAttributes = Readonly<Record<`data-${string}`, string | undefined>>;

	interface Props {
		label: string;
		selected: boolean;
		closeLabel: string;
		icon: Snippet;
		onclose: (event: MouseEvent) => void;
		onselect?: (event: MouseEvent) => void;
		trailing?: Snippet;
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
		description,
		tooltip,
		onpin,
		...rest
	}: Props = $props();

	const descriptionId = $props.id();

	const labelWidthClass: Record<BrowserTabSurface, string> = {
		panel: 'max-w-[13ch]',
		band: 'max-w-[24ch]',
	};

	const selectedClass: Record<BrowserTabSurface, string> = {
		panel: 'bg-surface-50-selected text-fg-default',
		band: 'bg-tab-selected text-fg-default',
	};

	const idleClass: Record<BrowserTabSurface, string> = {
		panel: 'text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-secondary',
		band: 'text-fg-tertiary hover:bg-tab-hover hover:text-fg-secondary',
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

	const surfaceClass = $derived(
		tone === 'brand'
			? 'bg-brand/10 text-brand-foreground'
			: selected
				? selectedClass[surface]
				: idleClass[surface],
	);
</script>

<div
	class={[
		'group/browser-tab has-[[role=tab]:focus-visible]:ring-button-primary/40 flex h-7 min-w-0 shrink-0 items-center overflow-hidden rounded-md transition-colors has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset motion-reduce:transition-none',
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
	<Tooltip content={closeLabel} placement={tooltipPlacement}>
		<IconButton
			bare
			ariaLabel={closeLabel}
			disabled={closeDisabled}
			class={[
				'focus-visible:ring-button-primary/40 relative mr-1 grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-sm opacity-0 transition-[opacity,background-color,color] outline-none group-hover/browser-tab:opacity-100 group-data-[selected=true]/browser-tab:opacity-100 before:absolute before:-inset-1 before:content-[""] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none',
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
		class="flex h-full min-w-0 cursor-pointer items-center gap-1 py-0 pr-0.5 pl-1.5 text-xs font-medium outline-none disabled:cursor-not-allowed"
		{...tabLink}
		{...tabAttributes}
	>
		<span class="grid h-4 w-4 shrink-0 place-items-center">{@render icon()}</span>
		<span
			class={['min-w-0 truncate whitespace-nowrap', labelWidthClass[surface], preview && 'italic']}
		>
			<SensitiveText text={label} />
		</span>
		{@render trailing?.()}
	</Button>
{/snippet}
