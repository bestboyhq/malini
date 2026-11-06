<script lang="ts">
	import { untrack } from 'svelte';
	import { Sensitive, sensitiveSegmentsAcross } from '$hyper-ui/components/sensitive';
	import { revealFade } from './arrival-motion';

	interface Props {
		text: string;
		unfold?: boolean;
	}

	let { text, unfold = true }: Props = $props();

	const WORD_REVEAL_MS = 28;
	const BACKLOG_CATCH_UP_MS = 600;

	const words = $derived(text.split(' ').filter(Boolean));
	const parts = $derived(
		sensitiveSegmentsAcross(words.map((word, index) => (index > 0 ? ` ${word}` : word))),
	);
	let shown = $state(untrack(() => (unfold ? 0 : words.length)));
	const revealing = $derived(shown < words.length);

	$effect(() => {
		if (!revealing) return;
		const from = untrack(() => shown);
		const stepMs = Math.min(
			WORD_REVEAL_MS,
			BACKLOG_CATCH_UP_MS / untrack(() => words.length - from),
		);
		let startedAtMs: number | undefined;
		let frame = requestAnimationFrame(function reveal(nowMs: number): void {
			startedAtMs ??= nowMs;
			const total = untrack(() => words.length);
			const count = Math.min(total, from + 1 + Math.floor((nowMs - startedAtMs) / stepMs));
			if (count !== untrack(() => shown)) shown = count;
			if (count < total) frame = requestAnimationFrame(reveal);
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

{#each parts.slice(0, shown) as segments, index (index)}<span in:revealFade>
		{#each segments as segment}{#if segment.kind}<Sensitive
					kind={segment.kind}
					text={segment.text}
					masked={segment.masked}
				/>{:else}{segment.text}{/if}{/each}
	</span>{/each}
