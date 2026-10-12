<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		title: string;
		headed?: boolean;
		note?: string | undefined;
		trailing?: Snippet;
		children: Snippet;
		class?: ClassValue;
	}

	let { title, headed = true, note, trailing, children, class: className }: Props = $props();
	const headingId = $props.id();
</script>

<section
	class={['bg-surface-root flex min-w-0 flex-col gap-1.5 rounded-[18px] p-1.5', className]}
	aria-labelledby={headed ? headingId : undefined}
	aria-label={headed ? undefined : title}
>
	{#if headed}
		<header class="flex h-8 items-center gap-2 pr-1.5 pl-3">
			<h3 id={headingId} class="text-fg-default text-xs font-medium">{title}</h3>
			{#if note}
				<span class="text-fg-tertiary text-3xs font-mono">{note}</span>
			{/if}
			{#if trailing}
				<div class="ml-auto">{@render trailing()}</div>
			{/if}
		</header>
	{/if}
	{@render children()}
</section>
