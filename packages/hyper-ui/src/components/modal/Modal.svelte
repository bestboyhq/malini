<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Icon } from '../../icons';
	import IconButton from '../icon-button/IconButton.svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { isEditableTarget, modalBehavior } from './modal-behavior';
	import { bodyPortal, OVERLAY_Z_INDEX, overlaySurface } from '../../overlay';

	type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

	type NavigationOutcomeKey = string;

	interface Props {
		open: boolean;
		title?: string;
		description?: string;
		ariaLabel?: string;
		onclose: () => void;
		onsubmit?: () => void;
		children: Snippet;
		size?: ModalSize;
		class?: ClassValue;
		contentClass?: ClassValue;
		closeOnBackdrop?: boolean;
		closeDisabled?: boolean;
		closeTitle?: string;
		navigationPathId?: string;
		navigationTarget?: string;
		navigationOutcomeKey?: NavigationOutcomeKey;
	}

	let {
		open,
		title,
		description,
		ariaLabel,
		onclose,
		onsubmit,
		children,
		size = 'md',
		class: className,
		contentClass,
		closeOnBackdrop = true,
		closeDisabled = false,
		closeTitle,
		navigationPathId,
		navigationTarget,
		navigationOutcomeKey,
	}: Props = $props();

	const sizeClass: Record<ModalSize, string> = {
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-2xl',
		xl: 'max-w-5xl',
	};

	let isClosing = $state(false);

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const descriptionId = `${uid}-description`;

	const hasConsumerRounded = $derived.by(() => {
		if (!className) return false;
		const flat = JSON.stringify(className);
		return /\brounded(-[\w[\]]+)?\b/.test(flat);
	});

	function startClose(): void {
		if (isClosing || closeDisabled) {
			return;
		}

		isClosing = true;

		setTimeout(() => {
			isClosing = false;
			onclose();
		}, 150);
	}

	function startSubmit(): void {
		if (isClosing || closeDisabled || !onsubmit) {
			return;
		}

		isClosing = true;

		setTimeout(() => {
			isClosing = false;
			onsubmit?.();
		}, 150);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (!open || event.defaultPrevented) {
			return;
		}

		if (event.key === 'Enter' && onsubmit && !isEditableTarget(event.target)) {
			event.preventDefault();
			startSubmit();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', onKeydown);

		return () => {
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

{#if open}
	<div
		class="fixed inset-0"
		style:z-index={OVERLAY_Z_INDEX.modal}
		data-overlay-portal
		use:bodyPortal
		use:overlaySurface
	>
		<div
			class="absolute inset-0 bg-black/60 backdrop-blur-xs"
			role="presentation"
			onclick={() => closeOnBackdrop && startClose()}
		></div>
		<div
			class="styled-scrollbar absolute top-1/2 left-1/2 flex h-fit w-fit -translate-x-1/2 -translate-y-1/2 flex-col"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			aria-label={title ? undefined : ariaLabel}
			aria-describedby={title && description ? descriptionId : undefined}
			data-navigation-path-id={navigationPathId}
			data-navigation-target={navigationTarget}
			data-navigation-outcome-key={navigationOutcomeKey}
			tabindex="-1"
			use:modalBehavior={{ onEscape: startClose }}
		>
			<div
				class={[
					'border-surface-modal-border bg-surface-modal text-fg-default shadow-popup inset-0 border',
					hasConsumerRounded ? null : 'rounded-xl',
					title ? sizeClass[size] : null,
					className,
					isClosing ? 'animate-scaleOut' : 'animate-scaleIn',
				]}
				onclick={(event) => event.stopPropagation()}
				role="presentation"
			>
				{#if title}
					<header
						class="border-border-subtle flex items-start justify-between gap-4 border-b px-5 py-4"
					>
						<div class="min-w-0">
							<h2 id={titleId} class="text-fg-default truncate text-lg font-semibold">
								{title}
							</h2>
							{#if description}
								<p id={descriptionId} class="text-fg-secondary mt-1 text-sm">{description}</p>
							{/if}
						</div>
						<Tooltip content={closeTitle ?? 'Close'} placement="top">
							<IconButton
								variant="ghost"
								size="sm"
								disabled={closeDisabled}
								ariaLabel={closeTitle ?? 'Close'}
								onclick={startClose}
							>
								<Icon name="close" size={16} />
							</IconButton>
						</Tooltip>
					</header>

					<div class={['p-5', contentClass]}>
						{@render children()}
					</div>
				{:else}
					<div class={contentClass}>
						{@render children()}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
