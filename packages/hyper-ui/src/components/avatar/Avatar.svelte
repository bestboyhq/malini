<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		name: string;
		src?: string | null;
		size?: 'sm' | 'md' | 'lg';
		class?: ClassValue;
	}

	let { name, src = null, size = 'md', class: className }: Props = $props();
	let failedSrc = $state<string | null>(null);

	const initials = $derived(
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part.slice(0, 1).toUpperCase())
			.join('') || 'C',
	);
	const showImage = $derived(Boolean(src) && failedSrc !== src);
	const sizeClass: Record<'sm' | 'md' | 'lg', string> = {
		sm: 'h-8 w-8 text-xs',
		md: 'h-11 w-11 text-sm',
		lg: 'h-14 w-14 text-base',
	};
</script>

<span
	class={[
		'border-surface-50-border bg-surface-50 text-fg-tertiary inline-grid shrink-0 place-items-center overflow-hidden rounded-md border font-bold',
		sizeClass[size],
		className,
	]}
>
	{#if showImage}
		<img
			class="h-full w-full object-cover"
			src={src ?? ''}
			alt=""
			onerror={() => (failedSrc = src)}
		/>
	{:else}
		{initials}
	{/if}
</span>
