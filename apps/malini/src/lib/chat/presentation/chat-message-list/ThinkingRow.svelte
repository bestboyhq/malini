<script lang="ts">
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly } from 'svelte/transition';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Icon } from '$hyper-ui/icons';
	import ExpandMark from '../ExpandMark.svelte';
	import MarkdownText from '../MarkdownText.svelte';
	import { transcriptContext } from './transcript-context';
	import {
		thinkingOutcome,
		thinkingSteps,
		thinkingTicker,
		thoughtLabel,
	} from './transcript-labels';

	interface Props {
		text: string;
		live: boolean;
		durationSeconds: number | null;
		enterKey: string;
	}

	let { text, live, durationSeconds, enterKey }: Props = $props();

	const WORD_REVEAL_MS = 28;
	const BACKLOG_CATCH_UP_MS = 600;

	const transcript = transcriptContext();
	const { stageEnter } = transcript;
	let stepsMounted = $state(false);
	const line = $derived(live ? thinkingTicker(text) : { key: 0, line: thinkingOutcome(text) });
	const lineKey = $derived(line.key);
	const words = $derived(line.line.split(' ').filter(Boolean));
	let revealed = $state(untrack(() => ({ key: lineKey, count: words.length })));
	const shown = $derived(!live ? words.length : revealed.key === lineKey ? revealed.count : 0);
	const revealing = $derived(shown < words.length);
	const steps = $derived(stepsMounted ? thinkingSteps(text) : []);
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);

	$effect(() => {
		if (!revealing) return;
		const key = lineKey;
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
			if (count !== untrack(() => shown)) revealed = { key, count };
			if (count < total) frame = requestAnimationFrame(reveal);
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<details
	class="group/expand text-fg-tertiary w-full text-sm"
	use:stageEnter={enterKey}
	data-message-kind={live ? 'thinking-live' : 'thinking'}
	data-testid={live ? 'thinking-live' : 'thinking-summary'}
>
	<summary
		class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
		onclick={() => (stepsMounted = true)}
	>
		<ExpandMark>
			<Icon name="brain" size={14} />
		</ExpandMark>
		{#if live}
			<ShimmerText text="Thinking" class="shrink-0" />
		{:else}
			<span class="shrink-0">{thoughtLabel(durationSeconds)}</span>
		{/if}
		<span
			class="grid min-w-0 flex-1 overflow-hidden transition-[opacity,visibility] duration-200 group-open/expand:invisible group-open/expand:opacity-0"
			data-testid={live ? 'thinking-live-preview' : 'thinking-outcome'}
		>
			{#key lineKey}
				<span
					class="text-fg-tertiary/75 truncate [grid-area:1/1]"
					in:fly={{ y: flip, duration: 260, easing: cubicOut }}
					out:fly={{ y: -flip, duration: 200, easing: cubicOut }}
				>
					{#each words.slice(0, shown) as word, index (index)}
						<span in:fade={{ duration: 190 }}>{index > 0 ? ` ${word}` : word}</span>
					{/each}
				</span>
			{/key}
		</span>
	</summary>
	{#if steps.length > 0}
		<ol
			class="border-surface-100-border mt-1 mb-2 ml-1.5 flex flex-col gap-2 border-l pl-3.5 text-xs leading-relaxed select-text"
			aria-label="Thinking steps"
			data-testid={live ? 'thinking-live-text' : 'thinking-summary-text'}
		>
			{#each steps as step, index (index)}
				<li class={index === steps.length - 1 ? 'text-fg-secondary' : 'text-fg-tertiary'}>
					<MarkdownText
						text={step}
						onopenfile={transcript.openFileMention}
						canopenfile={transcript.canOpenFileMention}
					/>
				</li>
			{/each}
		</ol>
	{/if}
</details>
