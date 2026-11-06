<script lang="ts">
	import { untrack } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import type { SubagentGroup } from '../activity-group';
	import { motionMs, revealFade } from '../arrival-motion';
	import ExpandMark from '../ExpandMark.svelte';
	import type { RunGroup } from '../render-state';
	import ToolLabel from '../ToolLabel.svelte';
	import { isBackgroundAgent } from '../tool-display-name';
	import SubagentRow from './SubagentRow.svelte';
	import { subagentGroupMeta, subagentGroupTicker, subagentGroupTitle } from './subagent-row-model';
	import { transcriptContext } from './transcript-context';

	interface Props {
		group: SubagentGroup;
		run: RunGroup;
	}

	let { group, run }: Props = $props();

	const FOLD_DELAY_MS = 700;

	const transcript = transcriptContext();
	const { stageEnter, timelineKey, expandedActivityGroups } = transcript;
	const running = $derived(group.agents.some((agent) => agent.tool.status === 'running'));
	const failed = $derived(group.agents.some((agent) => agent.tool.status === 'failed'));
	const background = $derived(
		group.agents.some((agent) => isBackgroundAgent(agent.tool.name, agent.tool.input)),
	);
	const title = $derived(subagentGroupTitle(group.agents));
	let folded = $state(untrack(() => !running));
	let nowMs = $state(Date.now());
	const expanded = $derived(expandedActivityGroups[group.key] ?? !folded);
	const meta = $derived(subagentGroupMeta(group.agents, nowMs, transcript.waitingForUser));

	$effect(() => {
		if (running) {
			folded = false;
			nowMs = Date.now();
			const clock = setInterval(() => (nowMs = Date.now()), 1_000);
			return () => clearInterval(clock);
		}
		const fold = setTimeout(() => (folded = true), FOLD_DELAY_MS);
		return () => clearTimeout(fold);
	});
</script>

<div
	class="w-full text-sm"
	use:stageEnter={timelineKey(run, group.key)}
	data-message-kind="subagent-group"
	data-testid="subagent-group"
>
	<div class="flex items-center gap-1">
		<Button
			bare
			class="group/expand text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent text-left transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
			ariaExpanded={expanded}
			data-testid="subagent-group-summary"
			onclick={() => (expandedActivityGroups[group.key] = !expanded)}
		>
			<ExpandMark keepIcon>
				{#if running}
					<BusyIcon size={14} {background} />
				{:else if failed}
					<Icon name="warning" size={14} class="text-error-content shrink-0" />
				{:else}
					<Icon name="workflow" size={14} class="shrink-0" />
				{/if}
			</ExpandMark>
			<span class="text-fg-secondary shrink-0" data-testid="subagent-group-title">
				{#if running}
					<ShimmerText text={title} />
				{:else}
					{title}
				{/if}
			</span>
			<span class="text-fg-tertiary/75 flex min-w-0 flex-1" data-testid="subagent-group-ticker">
				<ToolLabel title={subagentGroupTicker(group.agents)} />
			</span>
			{#if meta}
				<span
					class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums"
					data-testid="subagent-group-meta"
					in:revealFade
				>
					{meta}
				</span>
			{/if}
		</Button>
		<span class="w-5 shrink-0" aria-hidden="true"></span>
	</div>
	{#if expanded}
		<div
			class="mt-1 flex flex-col gap-2 pl-5.5"
			data-testid="subagent-group-agents"
			transition:slide={{
				duration: prefersReducedMotion.current ? 0 : motionMs(240),
				easing: quartOut,
			}}
		>
			{#each group.agents as agent (agent.key)}
				<SubagentRow item={agent} {run} />
			{/each}
		</div>
	{/if}
</div>
