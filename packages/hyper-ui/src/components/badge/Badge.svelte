<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

	interface Props {
		children: Snippet;
		variant?: BadgeVariant;
		class?: ClassValue;
	}

	let { children, variant = 'neutral', class: className }: Props = $props();

	const variantClass: Record<BadgeVariant, string> = {
		neutral: 'border-chip-border bg-chip text-fg-secondary',
		primary: 'border-surface-100-border bg-surface-100 text-fg-default',
		success: 'border-success-content/20 bg-success text-success-content',
		warning: 'border-warning-content/20 bg-warning text-warning-content',
		error: 'border-error-content/20 bg-error text-error-content',
	};
</script>

<span
	class={[
		'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
		variantClass[variant],
		className,
	]}
>
	{@render children()}
</span>
