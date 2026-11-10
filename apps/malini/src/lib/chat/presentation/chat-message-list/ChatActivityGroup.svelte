<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Icon } from '$hyper-ui/icons';
	import MarkdownText from '$shared/markdown/MarkdownText.svelte';
	import type { ActivityGroup } from '../activity-group';
	import { motionMs } from '../arrival-motion';
	import type { RunGroup } from '../render-state';
	import UnfoldText from '../UnfoldText.svelte';
	import ActivityKindIcons from './ActivityKindIcons.svelte';
	import ChatTimelineRow from './ChatTimelineRow.svelte';
	import { transcriptContext } from './transcript-context';
	import { thinkingOutcome } from './transcript-labels';

	interface Props {
		group: ActivityGroup;
		run: RunGroup;
		isLastRun: boolean;
		live?: boolean;
	}

	let { group, run, isLastRun, live = false }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey, expandedActivityGroups } = transcript;
	let everOpened = $state(false);
	const childrenMounted = $derived(everOpened || expandedActivityGroups[group.key] === true);
	const verb = $derived(live ? group.liveVerb : group.verb);
	const latest = $derived(
		live && group.latestMessage !== null ? thinkingOutcome(group.latestMessage) : '',
	);
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);
</script>

<div
	class="flex w-full flex-col gap-1"
	use:stageEnter={timelineKey(run, group.key)}
	data-message-kind="activity-group"
	data-activity-status={group.status}
	data-testid="chat-activity-group"
>
	<details
		class="group/activity w-full text-sm"
		bind:open={expandedActivityGroups[group.key]}
		ontoggle={(event) => (everOpened ||= event.currentTarget.open)}
	>
		<summary
			class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			aria-label={`${verb} ${group.detail}`}
			data-testid="chat-activity-group-summary"
		>
			<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
				<Icon
					name="chevron-right"
					size={10}
					class="transition-transform duration-150 group-open/activity:rotate-90"
				/>
			</span>
			<span class="text-fg-secondary shrink-0">
				{#if live}<ShimmerText text={verb} />{:else}{verb}{/if}
			</span>
			<span class="min-w-0 truncate"><SensitiveText text={group.detail} /></span>
			<ActivityKindIcons actionKinds={group.actionKinds} />
			{#if group.exitCodes.length > 0}
				<span class="text-3xs text-error-content shrink-0 font-mono tabular-nums">
					exit {group.exitCodes.join(', ')}
				</span>
			{/if}
			<span
				class="grid min-w-0 flex-1 overflow-hidden transition-[opacity,visibility] duration-200 group-open/activity:invisible group-open/activity:opacity-0"
				data-testid="chat-activity-group-latest"
			>
				{#key latest}
					<span
						class="text-fg-tertiary/75 truncate [grid-area:1/1]"
						in:fly={{ y: flip, duration: motionMs(260), easing: cubicOut }}
						out:fly={{ y: -flip, duration: motionMs(200), easing: cubicOut }}
					>
						<UnfoldText text={latest} unfold={false} />
					</span>
				{/key}
			</span>
		</summary>
		{#if childrenMounted}
			<div class="border-surface-100-border mt-1 flex flex-col gap-2 border-l pl-3.5">
				{#each group.items as child (child.key)}
					{#if child.kind === 'assistant'}
						<div
							class="text-fg-secondary flex w-full items-start gap-2 text-sm leading-6"
							use:stageEnter={timelineKey(run, child.contentId ?? child.key)}
							data-message-kind="activity-message"
							data-testid="chat-activity-group-message"
						>
							<span
								class="text-fg-tertiary grid h-6 w-3.5 shrink-0 place-items-center"
								aria-hidden="true"
							>
								<Icon name="chat" size={13} />
							</span>
							<div class="min-w-0 flex-1 select-text">
								<MarkdownText
									text={child.text}
									onopenfile={transcript.openFileMention}
									canopenfile={transcript.canOpenFileMention}
								/>
							</div>
						</div>
					{:else}
						<ChatTimelineRow item={child} {run} {isLastRun} />
					{/if}
				{/each}
			</div>
		{/if}
	</details>
	{#if !expandedActivityGroups[group.key]}
		{#each group.failures as failure (failure.key)}
			<div
				class="bg-error text-2xs text-error-content flex items-start gap-2 rounded-md px-2.5 py-1.5 leading-relaxed"
				data-testid="chat-activity-group-failed"
				data-failure-key={failure.key}
			>
				<Icon name="warning" size={12} class="mt-1 shrink-0" />
				<span class="min-w-0 flex-1 break-words select-text">
					<span class="text-error-content/75 font-mono">
						<SensitiveText text={failure.label} />
					</span>
					<span class="text-error-content/50 mx-1" aria-hidden="true">·</span>
					<span><SensitiveText text={failure.message} /></span>
				</span>
			</div>
		{/each}
	{/if}
</div>
