<script lang="ts">
	import type { RunningItem, WorkstreamRunning } from '$contract/stats';
	import { RenameText } from '$hyper-ui/components/rename-text';
	import { fittingCount } from './running-groups';

	interface Props {
		running: WorkstreamRunning;
		selected: boolean;
	}

	let { running, selected }: Props = $props();

	let frame: HTMLElement | undefined = $state();
	let ruler: HTMLElement | undefined = $state();
	let probe: HTMLElement | undefined = $state();
	let fitting = $state(Number.POSITIVE_INFINITY);

	const shown = $derived(running.items.slice(0, Math.max(1, fitting)));
	const hidden = $derived(running.items.length - shown.length);
	const summary = $derived(`Running: ${running.items.map((item) => item.name).join(', ')}`);

	$effect(() => {
		fit();
		if (!frame || !ruler) return;
		const observer = new ResizeObserver(fit);
		observer.observe(frame);
		observer.observe(ruler);
		return () => observer.disconnect();
	});

	function fit(): void {
		if (!frame || !ruler || !probe) return;
		const widths = Array.from(ruler.children, (item) => item.getBoundingClientRect().width);
		fitting = fittingCount(widths, frame.clientWidth, probe.getBoundingClientRect().width);
	}
</script>

{#snippet entry(item: RunningItem, index: number, shimmer: boolean)}
	<span class={['flex shrink-0 items-center gap-1.25', index > 0 && 'pl-2.5']}>
		<span
			class={[
				'shrink-0 rounded-full',
				selected && 'text-brand-icon',
				item.kind === 'task' ? 'size-1.5 border border-current' : 'size-1.25 bg-current',
			]}
		></span>
		<RenameText text={item.name} {shimmer} class="font-medium" />
	</span>
{/snippet}

<span
	class="text-3xs text-fg-quaternary relative flex min-w-0 overflow-hidden font-mono"
	bind:this={frame}
>
	<span class="sr-only">{summary}</span>
	<span
		class="flex min-w-0 whitespace-nowrap"
		aria-hidden="true"
		data-testid="workstream-running-line"
	>
		{#each shown as item, index (item.id)}
			{@render entry(item, index, true)}
		{/each}
		{#if hidden > 0}
			<span class="shrink-0 pl-2.5 font-medium">+{hidden}</span>
		{/if}
	</span>
	<span
		class="pointer-events-none invisible absolute top-0 left-0 flex w-max whitespace-nowrap"
		aria-hidden="true"
		bind:this={ruler}
	>
		{#each running.items as item, index (item.id)}
			{@render entry(item, index, false)}
		{/each}
	</span>
	<span
		class="pointer-events-none invisible absolute top-0 left-0 pl-2.5 font-medium whitespace-nowrap"
		aria-hidden="true"
		bind:this={probe}
	>
		+{running.items.length}
	</span>
</span>
