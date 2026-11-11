<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { revealFade, swapFly } from './arrival-motion';
	import UnfoldText from './UnfoldText.svelte';

	interface Props {
		title: string;
		detail?: string | null;
		emphasized?: boolean;
	}

	let { title, detail = null, emphasized = false }: Props = $props();

	const SWAP_MS = 260;

	let shown = $state(untrack(() => ({ title, detail, emphasized, swapped: false })));
	let swappedAtMs = Number.NEGATIVE_INFINITY;
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);
	const titleClass = $derived(['min-w-0 truncate', shown.emphasized && 'text-fg-secondary']);

	$effect(() => {
		const next = { title, detail, emphasized, swapped: true };
		const current = untrack(() => shown);
		if (
			next.title === current.title &&
			next.detail === current.detail &&
			next.emphasized === current.emphasized
		) {
			return;
		}
		const timer = setTimeout(
			() => {
				shown = next;
				swappedAtMs = performance.now();
			},
			swappedAtMs + SWAP_MS - performance.now(),
		);
		return () => clearTimeout(timer);
	});
</script>

<span class="grid min-w-0 flex-1 overflow-hidden">
	{#key shown.title}
		<span
			class="flex min-w-0 items-baseline gap-2 [grid-area:1/1]"
			in:swapFly={{ y: flip, durationMs: 260 }}
			out:swapFly={{ y: -flip, durationMs: 200 }}
		>
			<span class={titleClass}><UnfoldText text={shown.title} unfold={shown.swapped} /></span>
			{#if shown.detail}
				<span class="text-2xs min-w-0 flex-1 truncate font-mono" in:revealFade>
					<SensitiveText text={shown.detail} />
				</span>
			{/if}
		</span>
	{/key}
</span>
