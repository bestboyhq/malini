<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import { Icon } from '../../icons';
	import { overlaySurface } from '../../overlay';
	import type { ToastLevel } from './toast.store.svelte';

	interface Props {
		level: ToastLevel;
		message: string;
		action?: { label: string; onclick: () => void } | undefined;
		onDismiss?: () => void;
	}

	let { level, message, action, onDismiss }: Props = $props();

	const iconSurfaceClass: Record<ToastLevel, string> = {
		success: 'bg-success-content/12',
		error: 'bg-error-content/12',
		warning: 'bg-warning-content/12',
		info: 'bg-fg-tertiary/12',
		loading: 'bg-fg-tertiary/12',
	};

	const iconClass: Record<ToastLevel, string> = {
		success: 'text-success-content',
		error: 'text-error-content',
		warning: 'text-warning-content',
		info: 'text-fg-secondary',
		loading: 'text-fg-tertiary',
	};

	let contentWidth = $state<number>();

	function onActionClick(): void {
		action?.onclick();
		onDismiss?.();
	}
</script>

<div
	role="status"
	aria-live="polite"
	use:overlaySurface={{ anchored: true }}
	data-testid="toast"
	data-level={level}
	class="toast-pill border-surface-toast-border bg-surface-toast text-fg-default pointer-events-auto flex overflow-hidden rounded-xl border-[0.5px] text-sm antialiased shadow-lg"
	style:--toast-content-width={contentWidth === undefined ? undefined : `${contentWidth + 1}px`}
>
	<div
		class="toast-content flex w-max max-w-[calc(var(--width)-2px)] shrink-0 items-center gap-3 p-2"
		bind:clientWidth={contentWidth}
	>
		<div
			class={[
				'flex size-8 shrink-0 items-center justify-center rounded-lg',
				iconSurfaceClass[level],
			]}
		>
			{#if level === 'loading'}
				<span class={['loading loading-spinner size-4', iconClass[level]]}></span>
			{:else if level === 'success'}
				<Icon name="check" size={16} class={iconClass[level]} />
			{:else if level === 'error'}
				<Icon name="close" size={14} class={iconClass[level]} />
			{:else if level === 'warning'}
				<Icon name="warning" size={16} class={iconClass[level]} />
			{:else}
				<Icon name="info" size={16} class={iconClass[level]} />
			{/if}
		</div>
		<span class="min-w-0 break-words whitespace-normal"><SensitiveText text={message} /></span>
		{#if action}
			<button
				type="button"
				data-testid="toast-action"
				class="bg-surface-150 text-fg-default hover:bg-surface-150-hover focus-visible:ring-border-default/50 shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
				onclick={onActionClick}
			>
				{action.label}
			</button>
		{/if}
	</div>
</div>

<style>
	.toast-pill {
		width: var(--toast-content-width, auto);
		transition: width 130ms cubic-bezier(0, 0, 0.2, 1);
	}

	:global(
			[data-sonner-toaster]:has(
				[data-sonner-toast][data-removed='false'] ~ [data-sonner-toast][data-removed='false']
			)
		)
		.toast-pill {
		width: 100%;
	}

	.toast-content {
		transition: opacity 400ms ease;
	}

	:global([data-sonner-toast][data-expanded='false'][data-front='false']) .toast-content {
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.toast-pill,
		.toast-content {
			transition: none;
		}
	}
</style>
