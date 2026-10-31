<script lang="ts">
	import type { Snippet } from 'svelte';
	import ExtensionTile from './ExtensionTile.svelte';

	interface Props {
		title: string;
		note: string;
		summary: string;
		href?: string | undefined;
		dimmed?: boolean;
		trailing?: Snippet;
		children?: Snippet;
	}

	let { title, note, summary, href, dimmed = false, trailing, children }: Props = $props();
</script>

<article
	class="bg-surface-100 border-surface-100-border relative flex min-w-0 items-center gap-3 rounded-xl border-[0.5px] px-3 py-2.5 shadow-xs"
	aria-label={title}
>
	<ExtensionTile name={title} />
	<div class="flex min-w-0 flex-1 flex-col gap-0.5">
		<div class="flex min-w-0 items-baseline gap-2">
			{#if href}
				<a
					{href}
					class={[
						'focus-visible:after:ring-border-default/50 min-w-0 truncate text-[12.5px] font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2',
						dimmed ? 'text-fg-secondary' : 'text-fg-default',
					]}
				>
					{title}
				</a>
			{:else}
				<h4
					class={[
						'min-w-0 truncate text-[12.5px] font-medium',
						dimmed ? 'text-fg-secondary' : 'text-fg-default',
					]}
				>
					{title}
				</h4>
			{/if}
			<span class="text-fg-tertiary text-3xs shrink-0 font-mono">{note}</span>
		</div>
		<p class={['truncate text-xs', dimmed ? 'text-fg-tertiary' : 'text-fg-secondary']}>
			{summary}
		</p>
		{@render children?.()}
	</div>
	{#if trailing}
		<div class="relative z-10 flex shrink-0 items-center gap-2">
			{@render trailing()}
		</div>
	{/if}
</article>
