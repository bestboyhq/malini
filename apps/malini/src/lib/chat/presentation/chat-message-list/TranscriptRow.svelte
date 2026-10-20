<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		rowKey: string;
		initiallyMounted: boolean;
		estimate: () => number;
		children: Snippet;
	}

	let { rowKey, initiallyMounted, estimate, children }: Props = $props();

	const transcript = transcriptContext();
	const transcriptWindow = transcript.window;
	const mountedAtCreation = untrack(() => initiallyMounted);
	const mounted = $derived(transcriptWindow.mounted(rowKey, mountedAtCreation));
	const height = $derived(mounted ? null : (transcriptWindow.heightOf(rowKey) ?? estimate()));

	let remounting = false;
	$effect(() => {
		if (mounted && remounting) untrack(() => transcript.rebaseRowLayout());
		remounting = true;
	});
</script>

<div
	class="w-full"
	data-transcript-row
	data-transcript-placeholder={mounted ? undefined : ''}
	data-row-settled={mountedAtCreation ? undefined : ''}
	style:height={height === null ? undefined : `${height}px`}
	{@attach transcriptWindow.track(rowKey)}
>
	{#if mounted}
		{@render children()}
	{/if}
</div>
