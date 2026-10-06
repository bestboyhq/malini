<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		children: Snippet;
		footer?: Snippet;
		accent?: boolean;
		disabled?: boolean;
		class?: ClassValue;
		testId?: string;
		footerTestId?: string;
		mode?: string;
	}

	let {
		children,
		footer,
		accent = false,
		disabled = false,
		class: className,
		testId,
		footerTestId = 'composer-footer',
		mode,
	}: Props = $props();
</script>

<div
	class={[
		'group/composer bg-surface-composer @container/composer overflow-hidden rounded-xl border transition-[border-color] duration-150',
		accent
			? 'border-border-default hover:border-border-default focus-within:border-border-default'
			: 'border-surface-150-border/60 hover:border-surface-150-border focus-within:border-surface-150-border',
		disabled && 'opacity-80',
		className,
	]}
	inert={disabled}
	aria-disabled={disabled ? 'true' : undefined}
	data-testid={testId}
	data-composer-mode={mode}
	data-composer-disabled={disabled ? 'true' : undefined}
>
	{@render children()}
	{#if footer}
		<div
			class="flex h-11 flex-nowrap items-center justify-between gap-3 px-3 pb-2"
			data-testid={footerTestId}
			data-composer-footer-fixed=""
		>
			{@render footer()}
		</div>
	{/if}
</div>
