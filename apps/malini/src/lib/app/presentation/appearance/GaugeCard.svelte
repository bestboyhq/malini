<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { GaugeStatus } from './gauge-needle.svelte';

	interface Props {
		title: string;
		status: GaugeStatus;
		readout?: Snippet;
		children: Snippet;
		class?: ClassValue | undefined;
	}

	let { title, status, readout, children, class: className }: Props = $props();
</script>

<article
	class={[
		'bg-surface-100 border-surface-100-border flex min-w-0 flex-col gap-2.5 rounded-xl border-[0.5px] px-3 pt-2.5 pb-3 shadow-xs',
		className,
	]}
	data-gauge-status={status}
>
	<header class="flex h-5 items-center gap-2">
		<span
			class={[
				'size-1.5 shrink-0 rounded-full',
				status === 'idle' && 'bg-status-idle',
				status === 'driving' && 'bg-button-primary shadow-sm',
				status === 'following' && 'bg-accent shadow-sm',
			]}
			aria-hidden="true"
		></span>
		<h4 class="text-fg-default text-[12.5px] font-medium">{title}</h4>
		{#if readout}
			<span class="text-fg-tertiary text-3xs ml-auto flex gap-2 font-mono tabular-nums">
				{@render readout()}
			</span>
		{/if}
	</header>
	<div class="flex flex-1 items-center justify-center">
		{@render children()}
	</div>
</article>
