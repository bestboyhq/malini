<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		title: string;
		description?: string;
		icon?: Snippet;
		action?: Snippet;
		class?: ClassValue;
	}

	let { title, description, icon, action, class: className }: Props = $props();
</script>

<div
	class={[
		'border-surface-150-border bg-surface-150 flex min-h-48 flex-col items-center justify-center rounded-md border p-8 text-center',
		className,
	]}
>
	{#if icon}
		<div class="bg-surface-50 text-fg-tertiary mb-4 grid h-10 w-10 place-items-center rounded-full">
			{@render icon()}
		</div>
	{/if}
	<h3 class="text-fg-default text-sm font-semibold">{title}</h3>
	{#if description}
		<p class="text-fg-secondary mt-1 max-w-[32ch] text-sm leading-6">{description}</p>
	{/if}
	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>
