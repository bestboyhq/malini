<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		children: Snippet;
		class?: ClassValue;
	}

	let { children, class: className }: Props = $props();
</script>

<div class={['rounded-full px-0.5 text-center text-xs', className]}>
	{@render children()}
</div>
