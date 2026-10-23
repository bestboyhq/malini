<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		stacked?: boolean;
		children: Snippet;
	}

	let { title, description, stacked = false, children }: Props = $props();
</script>

<div
	class={[
		'gap-x-3 px-4 py-3',
		stacked ? 'flex flex-col gap-y-2.5' : 'grid grid-cols-[minmax(0,1fr)_auto] items-center',
	]}
>
	<div class="min-w-0">
		<h3 class="text-fg-default text-sm font-medium">{title}</h3>
		{#if description}
			<p class="text-fg-tertiary text-xs">{description}</p>
		{/if}
	</div>
	<div class={['flex min-w-0 flex-wrap items-center gap-2', !stacked && 'justify-end']}>
		{@render children()}
	</div>
</div>
