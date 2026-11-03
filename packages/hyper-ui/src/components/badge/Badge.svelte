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
		neutral: 'bg-fg-default/10 text-fg-default',
		primary: 'bg-surface-100 text-fg-default',
		success: 'bg-success text-success-content',
		warning: 'bg-warning text-warning-content',
		error: 'bg-error text-error-content',
	};
</script>

<span
	class={[
		'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold',
		variantClass[variant],
		className,
	]}
>
	{@render children()}
</span>
