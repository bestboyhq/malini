<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import type { RunGroup } from '../render-state';
	import type { RunTimelineItem } from '../run-timeline';
	import { relativizeWorkstreamPath } from '../workstream-path';
	import BashToolCall from '../BashToolCall.svelte';
	import BufferedStreamingMarkdown from '../BufferedStreamingMarkdown.svelte';
	import MarkdownText from '../MarkdownText.svelte';
	import AgentInteractionCard from '../AgentInteractionCard.svelte';
	import ChatPromptBubble from './ChatPromptBubble.svelte';
	import ChatToolRow from './ChatToolRow.svelte';
	import ContextHandoffDivider from './ContextHandoffDivider.svelte';
	import { blockKey } from './streaming-finalization';
	import { commandStatus } from './tool-row-model';
	import { thoughtLabel } from './transcript-labels';
	import { transcriptContext } from './transcript-context';

	interface Props {
		item: RunTimelineItem;
		run: RunGroup;
		isLastRun: boolean;
	}

	let { item, run, isLastRun }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey } = transcript;
	const planKey = $derived(`${run.runId}:${item.key}`);
</script>

{#if item.kind === 'user'}
	<ChatPromptBubble {item} {run} {isLastRun} />
{:else if item.kind === 'thought'}
	<details
		class="group/thought text-fg-tertiary w-full text-sm"
		use:stageEnter={timelineKey(run, item.contentId)}
		data-message-kind="thinking"
		data-testid="thinking-summary"
	>
		<summary
			class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-colors"
		>
			<Icon
				name="chevron-right"
				size={10}
				class="shrink-0 transition-transform duration-150 group-open/thought:rotate-90"
			/>
			<span>{thoughtLabel(item.durationSeconds)}</span>
		</summary>
		<div
			class="text-fg-secondary pt-1 pb-2 pl-[1.125rem] text-xs leading-relaxed select-text"
			data-testid="thinking-summary-text"
		>
			<MarkdownText
				text={item.text}
				onopenfile={transcript.openFileMention}
				canopenfile={transcript.canOpenFileMention}
			/>
		</div>
	</details>
{:else if item.kind === 'plan'}
	<div
		class="bg-surface-50 w-full rounded-md px-3 py-2.5"
		use:stageEnter={timelineKey(run, item.key)}
		data-message-kind="plan"
	>
		<div class="text-2xs text-fg-tertiary font-medium tracking-wider uppercase">Plan</div>
		<div class="text-fg-secondary mt-1 text-sm leading-relaxed select-text">
			<MarkdownText
				text={item.text}
				onopenfile={transcript.openFileMention}
				canopenfile={transcript.canOpenFileMention}
			/>
		</div>
		{#if planKey === transcript.latestImplementablePlanKey}
			<div class="border-surface-150-border mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
				<Button
					variant="primary"
					size="sm"
					class="font-normal"
					disabled={transcript.implementingPlanKey !== null}
					ariaBusy={transcript.implementingPlanKey === planKey}
					ariaLabel={`Implement plan with ${transcript.implementationModelLabel}`}
					data-testid="implement-plan"
					onclick={() => transcript.implementPlan(run.runId, item.key, item.text)}
				>
					{transcript.implementingPlanKey === planKey
						? 'Starting implementation…'
						: `Implement with ${transcript.implementationModelLabel}`}
				</Button>
				<span class="text-2xs text-fg-tertiary leading-5">
					Starts a fresh implementation chat with this plan and its original context.
				</span>
			</div>
		{/if}
	</div>
{:else if item.kind === 'assistant'}
	<div
		class="text-fg-agent-message w-full text-sm leading-relaxed"
		use:stageEnter={timelineKey(run, item.contentId ?? item.key)}
		data-message-kind="assistant"
		data-testid="chat-message-bubble"
	>
		<BufferedStreamingMarkdown
			text={item.text}
			class="select-text"
			playbackKey={item.contentId
				? blockKey(transcript.sessionId, run.runId, item.contentId)
				: undefined}
			complete={true}
			onopenfile={transcript.openFileMention}
			canopenfile={transcript.canOpenFileMention}
			imagesrc={transcript.markdownImageSource}
		/>
	</div>
{:else if item.kind === 'handoff'}
	<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>
		<ContextHandoffDivider />
	</div>
{:else if item.kind === 'tool'}
	<ChatToolRow {item} {run} />
{:else if item.kind === 'file'}
	<div
		class="text-fg-tertiary flex min-h-6 w-full items-center gap-2 pl-[0.875rem] text-sm"
		use:stageEnter={timelineKey(run, item.key)}
		data-message-kind="file"
		data-testid="run-activity-file"
		data-file-path={item.path}
	>
		<FileTypeIcon path={item.path} size={14} />
		<Tooltip content={relativizeWorkstreamPath(item.path)} placement="right" class="min-w-0">
			<span class="block truncate select-text">Edited {relativizeWorkstreamPath(item.path)}</span>
		</Tooltip>
	</div>
{:else if item.kind === 'command'}
	<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>
		<BashToolCall
			command={item.command}
			operationName="Shell"
			description={item.description ?? null}
			status={commandStatus(item)}
			output={item.output}
			error={item.error ?? null}
			exitCode={item.exitCode}
		/>
	</div>
{:else if item.kind === 'approval' || item.kind === 'question'}
	<div class="relative w-full" use:stageEnter={timelineKey(run, item.key)}>
		<AgentInteractionCard {item} />
	</div>
{:else if item.kind === 'unknown'}
	<div
		class="bg-surface-50 text-2xs text-fg-secondary w-full rounded-md px-2.5 py-2 font-mono select-text"
		use:stageEnter={timelineKey(run, item.key)}
		data-message-kind="unknown"
	>
		unknown: {JSON.stringify(item.raw)}
	</div>
{/if}
