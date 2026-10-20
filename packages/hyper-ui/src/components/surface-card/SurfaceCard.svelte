<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		children: Snippet;
		selected?: boolean;
		interactive?: boolean;
		class?: ClassValue;
	}

	let { children, selected = false, interactive = false, class: className }: Props = $props();
</script>

<div
	class={[
		'bg-surface-150 rounded-md border shadow-sm',
		selected ? 'border-primary' : 'border-surface-150-border',
		interactive ? 'hover:bg-surface-150-hover' : '',
		className,
	]}
>
	{@render children()}
</div>
