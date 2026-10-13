<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
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

	const transcript = transcriptContext();
	const { stageEnter } = transcript;
	let open = $state(false);
	const line = $derived(live ? thinkingTicker(text) : { key: 0, line: thinkingOutcome(text) });
	const steps = $derived(open ? thinkingSteps(text) : []);
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);
</script>

<details
	class="group/expand text-fg-tertiary w-full text-sm"
	bind:open
	use:stageEnter={enterKey}
	data-message-kind={live ? 'thinking-live' : 'thinking'}
	data-testid={live ? 'thinking-live' : 'thinking-summary'}
>
	<summary
		class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
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
			class="grid min-w-0 flex-1 overflow-hidden group-open/expand:invisible"
			data-testid={live ? 'thinking-live-preview' : 'thinking-outcome'}
		>
			{#key line.key}
				<span
					class="text-fg-tertiary/75 truncate [grid-area:1/1]"
					in:fly={{ y: flip, duration: 260, easing: cubicOut }}
					out:fly={{ y: -flip, duration: 200, easing: cubicOut }}
				>
					{line.line}
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
