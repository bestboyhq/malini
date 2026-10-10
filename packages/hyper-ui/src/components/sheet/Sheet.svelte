<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Icon } from '../../icons';
	import IconButton from '../icon-button/IconButton.svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { modalBehavior } from '../modal/modal-behavior';
	import {
		bodyPortal,
		getOverlayFocusReturn,
		OVERLAY_Z_INDEX,
		overlaySurface,
	} from '../../overlay';

	type SheetHeight = 'auto' | 'half' | 'full';

	interface Props {
		open: boolean;
		title?: string;
		description?: string;
		ariaLabel?: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
		height?: SheetHeight;
		class?: ClassValue;
		contentClass?: ClassValue;
		closeOnBackdrop?: boolean;
		closeDisabled?: boolean;
		closeTitle?: string;
	}

	let {
		open,
		title,
		description,
		ariaLabel,
		onclose,
		children,
		footer,
		height = 'auto',
		class: className,
		contentClass,
		closeOnBackdrop = true,
		closeDisabled = false,
		closeTitle,
	}: Props = $props();
	const focusReturn = getOverlayFocusReturn();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const descriptionId = `${uid}-description`;

	const heightClass: Record<SheetHeight, string> = {
		auto: 'max-h-[85vh]',
		half: 'h-[50vh]',
		full: 'h-[95vh]',
	};

	function requestClose(): void {
		if (closeDisabled) {
			return;
		}
		onclose();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 flex items-end justify-center bg-black/35 backdrop-blur-[1px]"
		style:z-index={OVERLAY_Z_INDEX.modal}
		data-overlay-portal
		use:bodyPortal
		use:overlaySurface
		role="presentation"
		onclick={() => closeOnBackdrop && requestClose()}
	>
		<div
			class={[
				'sheet-panel border-surface-modal-border bg-surface-modal text-fg-default shadow-popup flex w-full flex-col overflow-hidden rounded-t-xl border-t',
				heightClass[height],
				className,
			]}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			aria-label={title ? undefined : ariaLabel}
			aria-describedby={title && description ? descriptionId : undefined}
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			use:modalBehavior={{ onEscape: requestClose, focusReturn }}
		>
			<div class="grid place-items-center pt-2" aria-hidden="true">
				<span class="border-border-default h-1 w-10 rounded-full border-2"></span>
			</div>

			{#if title}
				<header class="flex items-start justify-between gap-4 px-5 py-3">
					<div class="min-w-0">
						<h2 id={titleId} class="text-fg-default truncate text-base font-semibold">{title}</h2>
						{#if description}
							<p id={descriptionId} class="text-fg-secondary mt-0.5 text-sm">{description}</p>
						{/if}
					</div>
					<Tooltip content={closeTitle ?? 'Close'} placement="top">
						<IconButton
							variant="ghost"
							size="sm"
							disabled={closeDisabled}
							ariaLabel={closeTitle ?? 'Close'}
							onclick={requestClose}
						>
							<Icon name="close" size={16} />
						</IconButton>
					</Tooltip>
				</header>
			{/if}

			<div class={['min-h-0 flex-1 overflow-auto px-5 pb-5', contentClass]}>
				{@render children()}
			</div>

			{#if footer}
				<footer class="border-border-subtle border-t px-5 py-3">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sheet-panel {
		animation: sheet-slide-in-bottom 180ms ease-out;
	}

	@keyframes sheet-slide-in-bottom {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet-panel {
			animation: none;
		}
	}
</style>
