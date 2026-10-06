<script lang="ts">
	import Sensitive from './Sensitive.svelte';
	import { sensitiveSegments } from './sensitive-segments';

	interface Props {
		text: string;
	}

	let { text }: Props = $props();
	const segments = $derived(sensitiveSegments(text));
</script>

{#each segments as segment}{#if segment.kind}<Sensitive kind={segment.kind}>
			{segment.text}
		</Sensitive>{:else}{segment.text}{/if}{/each}
