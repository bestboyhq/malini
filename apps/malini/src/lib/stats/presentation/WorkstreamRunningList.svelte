<script lang="ts">
	import { onMount } from 'svelte';
	import type { WorkstreamRunning } from '$contract/stats';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';
	import { stopRunningCommand } from '$lib/stats/application/commands/stop-running.command';
	import { stoppingRunningItemsQuery } from '$lib/stats/application/queries/stopping-running-items.query.svelte';
	import { runningGroups } from './running-groups';
	import { formatElapsed } from './stats-format';

	interface Props {
		running: WorkstreamRunning;
		onopenport: (port: number) => void;
	}

	let { running, onopenport }: Props = $props();

	const stopping = $derived(stoppingRunningItemsQuery.data(running.workstreamId));
	const groups = $derived(runningGroups(running.items));
	const everyItemStopping = $derived(running.items.every((item) => stopping.has(item.id)));

	let now = $state(Date.now());

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 1_000);
		return () => clearInterval(clock);
	});
</script>

<section class="flex flex-col" aria-label="Running">
	<div class="flex items-center justify-between gap-3">
		<span class="text-fg-default flex items-center gap-1.5 text-xs font-medium">
			<Icon name="terminal" size={14} class="text-brand-icon" />
			{running.items.length} running
		</span>
		<Button
			bare
			class="text-2xs text-fg-tertiary hover:text-fg-default focus-visible:ring-button-primary/40 cursor-pointer rounded px-1 outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
			disabled={everyItemStopping}
			onclick={() => stopRunningCommand(running.workstreamId, running.items)}
		>
			Stop all
		</Button>
	</div>
	{#each groups as group (group.label)}
		<h4 class="text-2xs text-fg-tertiary pt-1.5 font-medium">{group.label}</h4>
		<ul aria-label={group.label}>
			{#each group.items as item (item.id)}
				<li class="flex h-7 items-center gap-2 text-xs">
					<Icon
						name={item.origin === 'agent' ? 'terminal' : 'cube'}
						size={12}
						class="text-fg-tertiary shrink-0"
					/>
					<span class="text-fg-default max-w-36 shrink-0 truncate font-medium">{item.name}</span>
					<span class="text-2xs text-fg-tertiary min-w-0 flex-1 truncate font-mono">
						{item.detail}
					</span>
					{#each item.ports as port (port)}
						<Button
							bare
							class="bg-chip hover:bg-chip-hover text-2xs text-fg-secondary hover:text-fg-default focus-visible:ring-button-primary/40 inline-flex h-4.5 shrink-0 cursor-pointer items-center gap-0.75 rounded-md px-1.5 font-mono tabular-nums outline-none focus-visible:ring-2"
							ariaLabel={`Open localhost:${port}`}
							onclick={() => onopenport(port)}
						>
							:{port}
							<Icon name="external-link" size={10} />
						</Button>
					{/each}
					<span
						class="text-2xs text-fg-tertiary w-12 shrink-0 text-right tabular-nums"
						data-testid="running-item-elapsed"
					>
						{formatElapsed(now - item.startedAt)}
					</span>
					<IconButton
						variant="ghost"
						size="xs"
						class="shrink-0"
						ariaLabel={`Stop ${item.name}`}
						disabled={stopping.has(item.id)}
						onclick={() => stopRunningCommand(running.workstreamId, [item])}
					>
						<Icon name="stop" size={12} />
					</IconButton>
				</li>
			{/each}
		</ul>
	{/each}
	{#if running.behind.length > 0}
		<p class="text-2xs text-fg-tertiary pt-1">Behind them: {running.behind.join(' · ')}</p>
	{/if}
</section>
