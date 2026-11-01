<script lang="ts">
	import { onMount } from 'svelte';
	import { Slider, sliderPosition } from '$hyper-ui/components/slider';
	import { CONTEXT_WINDOW_RANGE, DEFAULT_CONTEXT_WINDOW } from '$contract/agent';
	import { chooseContextWindowCommand } from '$lib/app/application/commands/choose-context-window.command';
	import { loadContextWindowCommand } from '$lib/app/application/commands/load-context-window.command';
	import { contextWindowQuery } from '$lib/app/application/queries/context-window.query.svelte';

	const { min, max, step } = CONTEXT_WINDOW_RANGE;
	const tokenFormat = new Intl.NumberFormat('en', { notation: 'compact' });
	const headingId = $props.id();

	let dragged = $state<number | null>(null);
	const saved = $derived(contextWindowQuery.data);
	const shown = $derived(dragged ?? saved ?? DEFAULT_CONTEXT_WINDOW);

	onMount(loadContextWindowCommand);

	function choose(tokens: number): void {
		dragged = null;
		chooseContextWindowCommand(tokens);
	}
</script>

<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-4 pt-3 pb-2">
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
		<h3 id={headingId} class="text-fg-default text-sm font-medium">Context window</h3>
		<span class="text-fg-default text-sm tabular-nums">{tokenFormat.format(shown)}</span>
		<p class="text-fg-tertiary col-span-2 text-xs">
			When a chat's context fills to this size, Claude Code compacts it and Malini puts every
			message back. A bigger window compacts less often, but every turn costs more.
		</p>
	</div>
	<Slider
		value={shown}
		{min}
		{max}
		{step}
		marker={DEFAULT_CONTEXT_WINDOW}
		labelledBy={headingId}
		valueText={tokenFormat.format(shown)}
		disabled={saved === null}
		oninput={(tokens) => (dragged = tokens)}
		onchange={choose}
	/>
	<div class="text-fg-tertiary text-3xs relative h-4 font-mono" aria-hidden="true">
		<span class="absolute left-0">{tokenFormat.format(min)}</span>
		<span
			class="text-brand-foreground absolute -translate-x-1/2"
			style:left={sliderPosition(DEFAULT_CONTEXT_WINDOW, min, max)}
		>
			Recommended
		</span>
		<span class="absolute right-0">{tokenFormat.format(max)}</span>
	</div>
</div>
