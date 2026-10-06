<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '../../icons';
	import Tooltip from '../tooltip/Tooltip.svelte';
	import { isEditableTarget, modalBehavior } from '../modal/modal-behavior';
	import { bodyPortal, OVERLAY_Z_INDEX, overlaySurface } from '../../overlay';

	interface Props {
		open: boolean;
		onclose: () => void;
		onsubmit?: () => void;
		ariaLabel?: string;
		headerChildren?: Snippet;
		children: Snippet;
	}

	let { open, onclose, onsubmit, ariaLabel, headerChildren, children }: Props = $props();

	let isClosing = $state(false);

	function startClose(): void {
		if (isClosing) {
			return;
		}

		isClosing = true;

		setTimeout(() => {
			isClosing = false;
			onclose();
		}, 150);
	}

	function startSubmit(): void {
		if (isClosing || !onsubmit) {
			return;
		}

		isClosing = true;

		setTimeout(() => {
			isClosing = false;
			onsubmit?.();
		}, 150);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && onsubmit && !isEditableTarget(event.target)) {
			startSubmit();
		}
	}

	$effect(() => {
		if (!open) {
			return;
		}

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
			class="animate-fadeIn absolute inset-0 bg-black/80"
			role="presentation"
			onclick={startClose}
		></div>

		<div class="pointer-events-none absolute inset-0 flex h-full w-full flex-col p-4 sm:p-8">
			<div
				class="pointer-events-none relative flex h-full w-full flex-col"
				role="dialog"
				aria-modal="true"
				aria-label={ariaLabel}
				tabindex="-1"
				use:modalBehavior={{ onEscape: startClose }}
			>
				<Tooltip
					content="Close"
					placement="bottom"
					class="pointer-events-auto absolute top-12 right-2 z-10 sm:right-5"
				>
					<button type="button" class="icon-btn fcc p-0.5" onclick={startClose} aria-label="Close">
						<Icon name="close" size={40} class="text-white" />
					</button>
				</Tooltip>

				{#if headerChildren}
					<div class="pointer-events-auto">
						{@render headerChildren()}
					</div>
				{/if}

				<div
					class={[
						'styled-scrollbar pointer-events-auto flex h-full w-full flex-col rounded-lg bg-transparent',
						isClosing ? 'animate-scaleOut' : 'animate-scaleIn',
					]}
				>
					<div class="animate-fadeIn h-full w-full flex-1 px-4 pb-4">
						{@render children()}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
