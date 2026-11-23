<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from '../../icons/Icon.svelte';

	interface Props {
		label: string;
		mod?: string;
		size?: number;
		class?: ClassValue;
	}

	let { label, mod, size = 12, class: className }: Props = $props();
</script>

<kbd class={['inline-flex items-center font-sans', className]}>
	{#if mod}
		<span aria-hidden="true">{mod}</span>
	{/if}
	<Icon name="enter" {size} class={['-mr-0.5', mod && '-ml-0.5']} />
	<span class="sr-only">{label}</span>
</kbd>
