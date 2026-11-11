<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { leadActionKind, type ActivityGroup } from '../activity-group';
	import ExpandMark from '../ExpandMark.svelte';
	import type { RunGroup } from '../render-state';
	import ToolFailureNote from '../ToolFailureNote.svelte';
	import ActionKindIcon from '../ActionKindIcon.svelte';
	import ActivityKindIcons from './ActivityKindIcons.svelte';
	import StepRows from './StepRows.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		group: ActivityGroup;
		run: RunGroup;
		isLastRun: boolean;
	}

	let { group, run, isLastRun }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey, expandedActivityGroups } = transcript;
	let everOpened = $state(false);
	const open = $derived(expandedActivityGroups[group.key] === true);
	const childrenMounted = $derived(everOpened || open);
	const lead = $derived(leadActionKind(group.actionKinds));
</script>

<div
	class="flex w-full flex-col gap-1"
	use:stageEnter={timelineKey(run, group.key)}
	data-message-kind="activity-group"
	data-activity-status={group.status}
	data-testid="chat-activity-group"
>
	<details
		class="w-full text-sm"
		bind:open={expandedActivityGroups[group.key]}
		ontoggle={(event) => (everOpened ||= event.currentTarget.open)}
	>
		<summary
			class="group/expand text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			aria-label={`${group.verb} ${group.detail}`}
			aria-expanded={open}
			data-testid="chat-activity-group-summary"
		>
			<ExpandMark>
				<ActionKindIcon kind={lead} size={14} />
			</ExpandMark>
			<span class="text-fg-secondary shrink-0">{group.verb}</span>
			<span class="min-w-0 truncate"><SensitiveText text={group.detail} /></span>
			<ActivityKindIcons actionKinds={group.actionKinds.filter((kind) => kind !== lead)} />
			{#if group.exitCodes.length > 0}
				<span class="text-3xs text-error-content shrink-0 font-mono tabular-nums">
					exit {group.exitCodes.join(', ')}
				</span>
			{/if}
		</summary>
		{#if childrenMounted}
			<div class="border-surface-100-border mt-1 ml-1.5 flex flex-col gap-2 border-l pl-3.5">
				<StepRows rows={group.items} {run} {isLastRun} />
			</div>
		{/if}
	</details>
	{#if !expandedActivityGroups[group.key]}
		{#each group.failures as failure (failure.key)}
			<ToolFailureNote
				text={failure.message}
				label={failure.label}
				data-testid="chat-activity-group-failed"
				data-failure-key={failure.key}
			/>
		{/each}
	{/if}
</div>
