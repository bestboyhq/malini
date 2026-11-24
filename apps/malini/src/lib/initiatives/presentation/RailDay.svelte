<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { dateOf, isWeekend } from '$lib/initiatives/domain/initiative';
	import { dayName, weekdayOf } from './rail-labels';

	interface Props {
		day: string | null;
		today: string;
		dragging: boolean;
		ondrop: (() => void) | null;
		onadd?: (() => void) | undefined;
		children: Snippet;
	}

	let { day, today, dragging, ondrop, onadd, children }: Props = $props();

	let over: boolean = $state(false);

	const isToday = $derived(day === today);
	const dim = $derived(day !== null && isWeekend(day));

	function ondragover(event: DragEvent): void {
		if (!dragging || !ondrop) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		over = true;
	}

	function ondragleave(event: DragEvent): void {
		const into = event.relatedTarget;
		if (into instanceof Node && event.currentTarget instanceof Node) {
			if (event.currentTarget.contains(into)) return;
		}
		over = false;
	}

	function ondropped(event: DragEvent): void {
		over = false;
		if (!dragging || !ondrop) return;
		event.preventDefault();
		ondrop();
	}
</script>

<div
	class={[
		'group/reveal -mx-2 grid grid-cols-[64px_minmax(0,1fr)] gap-x-8 rounded-lg px-2 py-1',
		dragging && over && 'bg-surface-50',
	]}
	role="group"
	aria-label={day ? dayName(day) : 'No date'}
	{ondragover}
	{ondragleave}
	ondrop={ondropped}
>
	{#snippet date(day: string)}
		<span
			class={[
				'text-2xs w-7',
				isToday ? 'text-fg-default' : dim ? 'text-fg-quaternary' : 'text-fg-tertiary',
			]}
		>
			{weekdayOf(day)}
		</span>
		<span
			class={[
				'h-6 min-w-7 rounded-md px-1 text-center text-base leading-6 font-semibold tabular-nums',
				isToday
					? 'bg-surface-invert text-fg-invert'
					: dim
						? 'text-fg-quaternary'
						: 'text-fg-default',
			]}
		>
			{dateOf(day).getDate()}
		</span>
	{/snippet}
	{#if day && onadd}
		<Button
			bare
			class="hover:bg-surface-50 focus-visible:ring-border-default/50 -mx-1 flex h-8 cursor-pointer items-center gap-2 self-start rounded-md px-1 outline-0 focus-visible:ring-2"
			ariaLabel="Add an outcome on {dayName(day)}"
			onclick={onadd}
		>
			{@render date(day)}
		</Button>
	{:else}
		<div class="flex h-8 items-center gap-2" aria-hidden={day === null}>
			{#if day}
				{@render date(day)}
			{/if}
		</div>
	{/if}
	<div class="min-w-0">
		{@render children()}
	</div>
</div>
