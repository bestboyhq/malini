<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { brainHref } from '$shared/router/routes-hrefs';
	import { setBrainSyncCommand } from '$lib/brain/application/commands/set-brain-sync.command';
	import { brainQuery } from '$lib/brain/application/queries/brain.query.svelte';
	import {
		brainLogDays,
		brainSync,
		brainSyncLine,
		brainTopics,
		defaultBrainPath,
		inTopic,
		type BrainSync,
	} from '$lib/brain/domain/brain';

	interface Props {
		backHref: string;
		backLabel: string;
		selectedPath: string | null;
	}

	let { backHref, backLabel, selectedPath }: Props = $props();

	const MINUTE_MS = 60_000;
	const DOT: Readonly<Record<BrainSync['kind'], string>> = {
		synced: 'bg-success-content',
		local: 'bg-status-idle',
		waiting: 'bg-warning-content',
		problem: 'bg-error-content',
	};

	const brain = $derived(brainQuery.data);
	const entries = $derived(brain.entries ?? []);
	const topics = $derived(brainTopics(entries));
	const logDays = $derived(brainLogDays(entries));
	const shown = $derived(selectedPath ?? defaultBrainPath(entries));
	const sync = $derived(brain.status?.set ? brainSync(brain.status) : null);
	let now = $state(Date.now());

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), MINUTE_MS);
		return () => clearInterval(timer);
	});

	function slideIn(node: HTMLElement): ReturnType<typeof fly> {
		return fly(node, { x: 24, duration: motionOff() ? 0 : 220, easing: cubicOut });
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" in:slideIn data-testid="brain-nav">
	<div class="px-2.5 pt-1">
		<Button bare href={backHref} class="sidebar-row text-fg-secondary w-full gap-1.5 px-2">
			<Icon name="chevron-left" size={14} />
			<span class="min-w-0 truncate">{backLabel}</span>
		</Button>
	</div>

	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Brain">
		<nav class="flex flex-col gap-px px-2.5 pt-4 pb-4" aria-label="Brain">
			<h2 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Brain</h2>
			{#each topics as topic (topic.key)}
				{@const open = inTopic(topic, shown)}
				{@const href = topic.entry?.path ?? topic.children[0]?.path ?? null}
				{#if href}
					{@render row(topic.title, href, topic.children.length, false)}
				{/if}
				{#if open}
					{#each topic.children as child (child.path)}
						{@render row(child.title, child.path, 0, true)}
					{/each}
				{/if}
			{/each}

			{#if logDays.length > 0}
				<h2 class="text-fg-tertiary px-2 pt-6 pb-2.5 text-xs font-medium">Log</h2>
				{#each logDays as day (day.entry.path)}
					{@render row(day.label, day.entry.path, 0, false)}
				{/each}
			{/if}
		</nav>
	</ScrollableDiv>

	{#if sync}
		<div class="text-fg-tertiary flex shrink-0 items-center gap-2 px-4.5 py-3 text-xs">
			<span class={['size-1.5 shrink-0 rounded-full', DOT[sync.kind]]} aria-hidden="true"></span>
			<span class="min-w-0 flex-1 truncate" role="status">{brainSyncLine(sync, now)}</span>
			{#if sync.kind === 'problem'}
				<Button
					variant="ghost"
					size="xs"
					loading={brain.syncing}
					onclick={() => setBrainSyncCommand(true)}
				>
					Retry
				</Button>
			{/if}
		</div>
	{/if}
</div>

{#snippet row(label: string, path: string, count: number, nested: boolean)}
	{@const current = path === shown}
	<Button
		bare
		href={brainHref(path)}
		{...current ? { ariaCurrent: 'page' as const } : {}}
		class={[
			'sidebar-row w-full gap-2',
			nested ? 'pr-2 pl-7' : 'px-2',
			current ? 'sidebar-row-active' : 'text-fg-secondary',
		]}
	>
		<span class="min-w-0 flex-1 truncate text-left">{label}</span>
		{#if count > 0}
			<span class="text-fg-tertiary text-2xs shrink-0 font-mono tabular-nums">{count}</span>
		{/if}
	</Button>
{/snippet}
