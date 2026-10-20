<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from '../../icons/Icon.svelte';

	interface Props {
		mod?: boolean;
		size?: number;
		class?: ClassValue;
	}

	let { mod = false, size = 12, class: className }: Props = $props();
</script>

<kbd class={['inline-flex items-center font-sans', className]}>
	{#if mod}
		<span aria-hidden="true">⌘</span>
	{/if}
	<Icon name="enter" {size} class={['-mr-0.5', mod && '-ml-0.5']} />
	<span class="sr-only">{mod ? 'Command Return' : 'Return'}</span>
</kbd>
