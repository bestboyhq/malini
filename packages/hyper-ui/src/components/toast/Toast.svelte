<script lang="ts">
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import { BusyIcon, Icon } from '../../icons';
	import { overlaySurface } from '../../overlay';
	import type { ToastAction, ToastLevel } from './toast.store.svelte';

	interface Props {
		level: ToastLevel;
		message: string;
		actions?: readonly ToastAction[];
		onDismiss?: () => void;
	}

	let { level, message, actions = [], onDismiss }: Props = $props();

	const iconSurfaceClass: Record<ToastLevel, string> = {
		success: 'bg-success-content/12',
		error: 'bg-error-content/12',
		warning: 'bg-warning-content/12',
		info: 'bg-brand-icon/12',
		loading: 'bg-fg-tertiary/12',
	};

	const iconClass: Record<ToastLevel, string> = {
		success: 'text-success-content',
		error: 'text-error-content',
		warning: 'text-warning-content',
		info: 'text-brand-icon',
		loading: 'text-fg-tertiary',
	};

	function run(action: ToastAction): void {
		action.onclick();
		if (!action.keepOpen) onDismiss?.();
	}
</script>

<div
	role="status"
	aria-live="polite"
	use:overlaySurface={{ anchored: true }}
	data-testid="toast"
	data-level={level}
	class="border-surface-elevated-border bg-surface-elevated text-fg-default shadow-popup pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border-[0.5px] p-2.5 text-[13px] leading-5 antialiased"
>
	<div
		class={['flex size-6 shrink-0 items-center justify-center rounded-md', iconSurfaceClass[level]]}
	>
		{#if level === 'loading'}
			<BusyIcon size={14} class={iconClass[level]} />
		{:else if level === 'success'}
			<Icon name="check" size={14} class={iconClass[level]} />
		{:else if level === 'error'}
			<Icon name="close" size={12} class={iconClass[level]} />
		{:else if level === 'warning'}
			<Icon name="warning" size={14} class={iconClass[level]} />
		{:else}
			<Icon name="info" size={14} class={iconClass[level]} />
		{/if}
	</div>
	<div class="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5">
		<span class="max-w-full break-words"><SensitiveText text={message} /></span>
		{#if actions.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each actions as action (action.label)}
					<button
						type="button"
						class="border-surface-150-border bg-surface-150 text-fg-default hover:bg-surface-150-hover focus-visible:ring-border-default/50 cursor-pointer rounded-lg border-[0.5px] px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
						onclick={() => run(action)}
					>
						{action.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
