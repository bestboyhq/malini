<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import type { ActivityGroup } from '../activity-group';
	import type { RunGroup } from '../render-state';
	import ChatTimelineRow from './ChatTimelineRow.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		group: ActivityGroup;
		run: RunGroup;
		isLastRun: boolean;
	}

	let { group, run, isLastRun }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey, expandedActivityGroups } = transcript;
</script>

<div
	class="flex w-full flex-col gap-1"
	use:stageEnter={timelineKey(run, group.key)}
	data-message-kind="activity-group"
	data-activity-status={group.status}
	data-testid="chat-activity-group"
>
	<details class="group/activity w-full text-sm" bind:open={expandedActivityGroups[group.key]}>
		<summary
			class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			aria-label={`${group.verb} ${group.detail}`}
			data-testid="chat-activity-group-summary"
		>
			<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
				<Icon
					name="chevron-right"
					size={10}
					class="transition-transform duration-150 group-open/activity:rotate-90"
				/>
			</span>
			<span class="text-fg-secondary shrink-0">{group.verb}</span>
			<span class="min-w-0 truncate"><SensitiveText text={group.detail} /></span>
			<span class="flex shrink-0 items-center gap-1" aria-hidden="true">
				{#each group.actionKinds as actionKind (actionKind)}
					{#if actionKind === 'edit'}
						<Icon name="pencil" class="shrink-0" size={12} />
					{:else if actionKind === 'command'}
						<Icon name="terminal" size={12} class="shrink-0" />
					{:else if actionKind === 'read'}
						<Icon name="note" size={12} class="shrink-0" />
					{:else if actionKind === 'search'}
						<Icon name="search" size={12} class="shrink-0" />
					{/if}
				{/each}
			</span>
		</summary>
		<div class="border-surface-100-border mt-1 flex flex-col gap-2 border-l pl-3.5">
			{#each group.items as child (child.key)}
				<ChatTimelineRow item={child} {run} {isLastRun} />
			{/each}
		</div>
	</details>
	{#if !expandedActivityGroups[group.key]}
		{#each group.failures as failure (failure.key)}
			<div
				class="bg-error text-2xs text-error-content flex items-start gap-2 rounded-md px-2.5 py-1.5 leading-relaxed"
				data-testid="chat-activity-group-failed"
				data-failure-key={failure.key}
			>
				<Icon name="warning" size={12} class="mt-px shrink-0" />
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
