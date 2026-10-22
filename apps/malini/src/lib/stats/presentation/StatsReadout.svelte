<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { loadActivityCommand } from '$lib/stats/application/commands/load-activity.command';
	import { loadResourcesCommand } from '$lib/stats/application/commands/load-resources.command';
	import { watchResourcesHook } from '$lib/stats/application/hooks/watch-resources.hook';
	import { latestResourceSampleQuery } from '$lib/stats/application/queries/latest-resource-sample.query.svelte';
	import StatsPanel from './StatsPanel.svelte';
	import { formatCpu, formatMemory } from './stats-format';

	const latest = $derived(latestResourceSampleQuery.data);
	const readout = $derived(
		latest ? `${formatMemory(latest.memoryBytes)} · ${formatCpu(latest.cpuPercent)}` : null,
	);

	let readoutRect: DOMRectReadOnly | undefined = $state();
	const readoutWidth = Tween.of(() => readoutRect?.width ?? 0, {
		duration: (from) => (from === 0 || prefersReducedMotion.current ? 0 : 200),
		easing: cubicOut,
	});
	let open = $state(false);
	let trigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);

	onMount(() => {
		loadResourcesCommand();
		return watchResourcesHook();
	});

	function onToggle(): void {
		open = !open;
		if (open) loadActivityCommand();
	}
</script>

<Tooltip content="Stats for nerds" placement="top" suppressed={open} class="ml-auto min-w-0">
	<Button
		bind:element={trigger}
		variant="ghost"
		size="auto"
		class="text-fg-tertiary h-6 px-1.5 text-xs tabular-nums"
		ariaLabel={readout ? `Stats: ${readout} CPU` : 'Stats'}
		ariaHasPopup="dialog"
		ariaExpanded={open}
		active={open}
		onclick={onToggle}
		data-testid="sidebar-open-stats"
	>
		<span class="flex items-center gap-1">
			<Icon name="signal" size={14} />
			{#if readout}
				<span
					class="flex justify-end overflow-hidden"
					style:width={readoutWidth.current ? `${readoutWidth.current}px` : undefined}
				>
					<span
						class="w-max shrink-0"
						bind:contentRect={readoutRect}
						data-testid="sidebar-stats-readout"
					>
						{readout}
					</span>
				</span>
			{/if}
		</span>
	</Button>
</Tooltip>

<DropdownLayer
	{open}
	anchor={trigger}
	onclose={() => (open = false)}
	side="top"
	align="end"
	role={null}
	keyboardNavigation={false}
	backdrop
	panelClass="w-[380px] max-h-[calc(100vh-72px)] overflow-y-auto rounded-2xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-3 shadow-popup"
	testId="stats-panel-layer"
>
	<div role="dialog" aria-label="Stats" data-testid="stats-panel">
		<StatsPanel />
	</div>
</DropdownLayer>
