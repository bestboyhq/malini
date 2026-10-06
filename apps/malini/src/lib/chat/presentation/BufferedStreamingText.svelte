<script lang="ts">
	import { onDestroy, untrack } from 'svelte';

	interface Props {
		text: string;
		class?: string;
		intervalMs?: number;
	}

	let { text, class: className = '', intervalMs = 220 }: Props = $props();
	const initialText = untrack(() => text);
	let visibleText = $state(initialText);
	let latestText = initialText;
	let publishTimer: ReturnType<typeof setTimeout> | null = null;

	function schedulePublish(): void {
		if (publishTimer !== null) return;
		publishTimer = setTimeout(
			() => {
				publishTimer = null;
				visibleText = latestText;
			},
			Math.max(0, intervalMs),
		);
	}

	$effect(() => {
		const source = text;
		untrack(() => {
			latestText = source;
			schedulePublish();
		});
	});

	onDestroy(() => {
		if (publishTimer !== null) clearTimeout(publishTimer);
	});
</script>

<span class={className} data-testid="buffered-streaming-text">{visibleText}</span>
