<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import { tick, untrack, type Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import Button from '../button/Button.svelte';
	import IconButton from '../icon-button/IconButton.svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { BusyIcon, Icon } from '../../icons';
	import {
		RENAME_BAND_PX,
		RENAME_SEAM_PX,
		RENAME_SWEEP_MS,
		renameSweepFrame,
	} from './rename-sweep';

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
		[attr: `data-${string}`]: string | undefined;
	}

	type Rename = {
		readonly from: string;
		readonly fromWidth: number;
		readonly toWidth: number;
		readonly fromOverflows: boolean;
		readonly toOverflows: boolean;
	};

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
		backgroundBusy = false,
		description,
		tooltip,
		onpin,
		shimmerRename = false,
		...rest
	}: Props = $props();

	const descriptionId = $props.id();
	let labelOverflow = $state(0);
	let labelBox: HTMLElement | undefined = $state();
	let labelText: HTMLElement | undefined = $state();
	let shownLabel = untrack(() => label);
	let rename = $state.raw<Rename | null>(null);
	const renameProgress = new Tween(1, { duration: RENAME_SWEEP_MS });
	const renameFrame = $derived(
		rename && renameProgress.current < 1
			? renameSweepFrame(renameProgress.current, rename.fromWidth, rename.toWidth)
			: null,
	);
	const labelOverflowing = $derived(
		renameFrame && rename ? rename.fromOverflows || rename.toOverflows : labelOverflow > 0,
	);
	const labelFadeIn = $derived(
		renameFrame && rename ? overflowFadeAt(rename, renameFrame.width) : undefined,
	);

	$effect.pre(() => {
		const next = label;
		untrack(() => {
			const from = shownLabel;
			shownLabel = next;
			if (from === next || !shimmerRename || prefersReducedMotion.current || !labelBox) return;
			void startRename(labelBox, from);
		});
	});

	async function startRename(box: HTMLElement, from: string): Promise<void> {
		const fromWidth = box.getBoundingClientRect().width;
		const fromOverflows = labelOverflowing;
		await tick();
		if (!labelText || !box.isConnected) return;
		const textWidth = labelText.getBoundingClientRect().width;
		const toWidth = Math.min(textWidth, parseFloat(getComputedStyle(box).maxWidth) || Infinity);
		rename = { from, fromWidth, toWidth, fromOverflows, toOverflows: textWidth - toWidth > 0.5 };
		void renameProgress.set(0, { duration: 0 });
		void renameProgress.set(1);
	}

	function overflowFadeAt(sweep: Rename, width: number): number {
		const span = sweep.toWidth - sweep.fromWidth;
		const settled = span === 0 ? 1 : Math.min(Math.max((width - sweep.fromWidth) / span, 0), 1);
		const from = Number(sweep.fromOverflows);
		return from + (Number(sweep.toOverflows) - from) * settled;
	}

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

	const tabPaddingClass = $derived(icon || busy || backgroundBusy ? 'pr-2 pl-1.5' : 'px-2');

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
				onclick={onclose}
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
			'flex h-full min-w-0 cursor-pointer items-center gap-1 py-0 text-xs font-medium outline-none disabled:cursor-not-allowed',
			tabPaddingClass,
		]}
		{...tabLink}
		{...tabAttributes}
	>
		{#if busy || backgroundBusy}
			<span
				class={[
					'grid h-4 w-4 shrink-0 place-items-center',
					busy && !selected && 'text-fg-secondary',
				]}
				aria-hidden="true"
			>
				<BusyIcon size={12} background={!busy} />
			</span>
		{:else if icon}
			<span class="grid h-4 w-4 shrink-0 place-items-center">{@render icon()}</span>
		{/if}
		<span
			bind:this={labelBox}
			class={[
				'tab-label relative min-w-0 overflow-hidden whitespace-nowrap',
				labelWidthClass[surface],
				preview && 'pr-0.5 italic',
				busy && !selected && 'text-fg-secondary',
				onclose && !trailing && 'tab-label-faded',
				renameFrame && 'tab-label-renaming',
			]}
			data-overflowing={labelOverflowing ? 'true' : undefined}
			style:--tab-label-overflow={labelOverflow}
			style:--tab-label-fade-in={labelFadeIn}
			style:width={renameFrame ? `${renameFrame.width}px` : undefined}
			style:--rename-center={renameFrame ? `${renameFrame.center}px` : undefined}
			style:--rename-dim={renameFrame?.dim}
			style:--rename-band={renameFrame ? `${RENAME_BAND_PX}px` : undefined}
			style:--rename-seam={renameFrame ? `${RENAME_SEAM_PX}px` : undefined}
		>
			<span class="tab-label-text" bind:this={labelText} {@attach observeLabelOverflow}>
				<SensitiveText text={label} />
			</span>
			{#if renameFrame && rename}
				<span class="tab-label-previous" aria-hidden="true">
					<SensitiveText text={rename.from} interactive={false} />
				</span>
				<span class="tab-label-glint" aria-hidden="true">
					<span class="tab-label-next"><SensitiveText text={label} interactive={false} /></span>
					<span class="tab-label-previous">
						<SensitiveText text={rename.from} interactive={false} />
					</span>
				</span>
			{/if}
		</span>
		{#if trailing && onclose}
			<span
				class={[
					surface === 'band' ? 'grid h-4 w-4 place-items-center' : 'flex',
					'shrink-0',
					hiddenUnderCloseClass,
				]}
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
		mask-image: linear-gradient(
			to left,
			transparent,
			black calc(var(--tab-label-fade) * var(--tab-label-fade-in, 1) * 1px)
		);
	}

	.browser-tab:is(:hover, :has(:global(:focus-visible))) .tab-label-faded {
		--tab-label-fade: 26;
		mask-image: linear-gradient(to left, transparent 16px, black calc(var(--tab-label-fade) * 1px));
	}

	.tab-label-renaming > .tab-label-text,
	.tab-label-renaming > .tab-label-previous {
		color: color-mix(
			in srgb,
			var(--color-fg-tertiary) calc(var(--rename-dim) * 100%),
			currentColor
		);
	}

	.tab-label-renaming .tab-label-text,
	.tab-label-next {
		mask-image: linear-gradient(
			90deg,
			black calc(var(--rename-center) - var(--rename-seam)),
			transparent calc(var(--rename-center) + var(--rename-seam))
		);
	}

	.tab-label-previous,
	.tab-label-next {
		position: absolute;
		top: 0;
		left: 0;
	}

	.tab-label-previous {
		mask-image: linear-gradient(
			90deg,
			transparent calc(var(--rename-center) - var(--rename-seam)),
			black calc(var(--rename-center) + var(--rename-seam))
		);
	}

	.tab-label-glint {
		position: absolute;
		inset: 0;
		color: var(--color-fg-default);
		mask-image: linear-gradient(
			90deg,
			transparent calc(var(--rename-center) - var(--rename-band) / 2),
			black var(--rename-center),
			transparent calc(var(--rename-center) + var(--rename-band) / 2)
		);
	}

	.browser-tab:hover .tab-label[data-overflowing]:not(.tab-label-renaming) .tab-label-text {
		--tab-label-shift: calc(var(--tab-label-overflow) + var(--tab-label-fade));
		transform: translateX(calc(var(--tab-label-shift) * -1px));
		transition: transform calc(var(--tab-label-shift) * 20ms) linear 300ms;
	}

	@media (prefers-reduced-motion: reduce) {
		.browser-tab:hover .tab-label[data-overflowing] .tab-label-text {
			transition-duration: 0s;
		}
	}
</style>
