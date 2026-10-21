<script lang="ts">
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly } from 'svelte/transition';
	import { hasSensitiveText, SensitiveText } from '$hyper-ui/components/sensitive';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';

	interface Props {
		title: string;
		detail?: string | null;
		emphasized?: boolean;
		live: boolean;
	}

	let { title, detail = null, emphasized = false, live }: Props = $props();

	const SWAP_MS = 260;

	let shown = $state(untrack(() => ({ title, detail, emphasized })));
	let swappedAtMs = Number.NEGATIVE_INFINITY;
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);
	const titleClass = $derived(['min-w-0 truncate', shown.emphasized && 'text-fg-secondary']);

	$effect(() => {
		const next = { title, detail, emphasized };
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
			in:fly={{ y: flip, duration: 260, easing: cubicOut }}
			out:fly={{ y: -flip, duration: 200, easing: cubicOut }}
		>
			{#if hasSensitiveText(shown.title)}
				<span class={titleClass}><SensitiveText text={shown.title} /></span>
			{:else}
				<ShimmerText text={shown.title} active={live} class={titleClass} />
			{/if}
			{#if shown.detail}
				<span class="text-2xs min-w-0 flex-1 truncate font-mono" in:fade={{ duration: 190 }}>
					<SensitiveText text={shown.detail} />
				</span>
			{/if}
		</span>
	{/key}
</span>
