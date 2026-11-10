<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Icon } from '$hyper-ui/icons';
	import { arrivalMotion, swapFly } from '../arrival-motion';
	import ExpandMark from '../ExpandMark.svelte';
	import MarkdownText from '$shared/markdown/MarkdownText.svelte';
	import UnfoldText from '../UnfoldText.svelte';
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
	const startedLive = untrack(() => live);
	let stepsMounted = $state(false);
	const line = $derived(live ? thinkingTicker(text) : { key: 0, line: thinkingOutcome(text) });
	const lineKey = $derived(line.key);
	const mountedLineKey = untrack(() => lineKey);
	const steps = $derived(stepsMounted ? thinkingSteps(text) : []);
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);

	function glideWidth(box: HTMLElement): () => void {
		const content = box.firstElementChild;
		if (!(content instanceof HTMLElement)) return () => undefined;
		let width = content.offsetWidth;
		const observer = new ResizeObserver(() => {
			const gliding = box.getAnimations().length > 0;
			const from = gliding ? box.getBoundingClientRect().width : width;
			width = content.offsetWidth;
			if (from === width || prefersReducedMotion.current || document.hidden) return;
			const { durationMs, easing } = arrivalMotion();
			box.animate([{ width: `${from}px` }, { width: `${width}px` }], {
				duration: durationMs,
				easing,
			});
		});
		observer.observe(content);
		return () => observer.disconnect();
	}
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
		<span class="shrink-0 overflow-hidden" {@attach startedLive ? glideWidth : undefined}>
			<span class="grid w-max">
				{#key live}
					<span
						class="whitespace-nowrap [grid-area:1/1]"
						in:swapFly={{ y: flip, durationMs: 260 }}
						out:swapFly={{ y: -flip, durationMs: 200 }}
					>
						{#if live}
							<ShimmerText text="Thinking" />
						{:else}
							{thoughtLabel(durationSeconds)}
						{/if}
					</span>
				{/key}
			</span>
		</span>
		<span
			class="grid min-w-0 flex-1 overflow-hidden transition-[opacity,visibility] duration-200 group-open/expand:invisible group-open/expand:opacity-0"
			data-testid={live ? 'thinking-live-preview' : 'thinking-outcome'}
		>
			{#key lineKey}
				<span
					class="text-fg-tertiary/75 truncate [grid-area:1/1]"
					in:swapFly={{ y: flip, durationMs: 260 }}
					out:swapFly={{ y: -flip, durationMs: 200 }}
				>
					<UnfoldText text={line.line} unfold={live && lineKey !== mountedLineKey} />
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
