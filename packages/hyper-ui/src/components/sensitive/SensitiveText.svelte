<script lang="ts">
	import Sensitive from './Sensitive.svelte';
	import { sensitiveSegments } from './sensitive-segments';

	interface Props {
		text: string;
		interactive?: boolean;
	}

	let { text, interactive = true }: Props = $props();
	const segments = $derived(sensitiveSegments(text));
</script>

{#each segments as segment}{#if segment.kind}<Sensitive
			kind={segment.kind}
			text={segment.text}
			masked={segment.masked}
			{interactive}
		/>{:else}{segment.text}{/if}{/each}
