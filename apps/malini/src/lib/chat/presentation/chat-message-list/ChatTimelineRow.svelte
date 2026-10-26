<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { runLastSeq, type RunGroup } from '../render-state';
	import type { RunTimelineItem } from '../run-timeline';
	import BashToolCall from '../BashToolCall.svelte';
	import EditDiffPreview from '../EditDiffPreview.svelte';
	import FileToolRow from '../FileToolRow.svelte';
	import BufferedStreamingMarkdown from '../BufferedStreamingMarkdown.svelte';
	import MarkdownText from '../MarkdownText.svelte';
	import AgentInteractionCard from '../AgentInteractionCard.svelte';
	import AgentQuestionRow from './AgentQuestionRow.svelte';
	import TurnReportCard from '../TurnReportCard.svelte';
	import { finalTurnReport } from '../turn-result';
	import { noVariantFitsPrompt, variantPickPrompt } from '$lib/chat/domain/variant-pick';
	import ChatPromptBubble from './ChatPromptBubble.svelte';
	import ChatToolRow from './ChatToolRow.svelte';
	import ThinkingRow from './ThinkingRow.svelte';
	import ContextHandoffDivider from './ContextHandoffDivider.svelte';
	import { blockKey } from './streaming-finalization';
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
	const turnReport = $derived(
		item.kind === 'assistant' ? finalTurnReport(run, item.key, item.text) : null,
	);
	const earlierTurns = $derived(turnReport ? transcript.earlierTurns(run.runId) : []);
	const reportSeq = $derived(turnReport ? runLastSeq(run) : null);
	const variantPick = $derived(
		turnReport ? (transcript.variantPick(run.runId)?.pick ?? null) : null,
	);
</script>

{#if item.kind === 'user'}
	<ChatPromptBubble {item} {run} {isLastRun} />
{:else if item.kind === 'thought'}
	<ThinkingRow
		text={item.text}
		live={item.live === true}
		durationSeconds={item.durationSeconds}
		enterKey={timelineKey(run, item.contentId)}
	/>
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
		class="text-fg-default w-full text-sm leading-relaxed"
		use:stageEnter={timelineKey(run, item.contentId ?? item.key)}
		data-message-kind="assistant"
		data-testid="chat-message-bubble"
	>
		{#if turnReport}
			<TurnReportCard
				report={turnReport}
				workstreamId={transcript.workstreamId}
				history={earlierTurns}
				needsOpen={isLastRun && !transcript.pullRequestShipped}
				pick={variantPick}
				pickOf={(runId) => transcript.variantPick(runId)?.pick ?? null}
				onopenfile={transcript.openFileMention}
				canopenfile={transcript.canOpenFileMention}
				imagesrc={transcript.markdownImageSource}
				onopenimage={transcript.openImageGallery}
				onpick={(variant, reason) =>
					transcript.sendFollowUp(variantPickPrompt(variant, reason), 'Pick')}
				onnonefit={(reason) => transcript.sendFollowUp(noVariantFitsPrompt(reason), 'Request')}
				onsendnext={(step) => transcript.sendFollowUp(step, 'Next step')}
				onforknext={reportSeq === null
					? undefined
					: (step) => transcript.shipInFork(step, 'Next step', reportSeq)}
				onscratchpad={transcript.saveToScratchpad}
			/>
		{:else}
			<BufferedStreamingMarkdown
				text={item.text}
				class="select-text"
				playbackKey={item.contentId
					? blockKey(transcript.sessionId, run.runId, item.contentId)
					: undefined}
				complete={true}
				flush={!isLastRun}
				revealOnMount={!transcript.transcriptSettled()}
				onopenfile={transcript.openFileMention}
				canopenfile={transcript.canOpenFileMention}
				imagesrc={transcript.markdownImageSource}
				onopenimage={transcript.openImageGallery}
				onruncommand={transcript.runShellCommand}
			/>
		{/if}
	</div>
{:else if item.kind === 'handoff'}
	<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>
		<ContextHandoffDivider />
	</div>
{:else if item.kind === 'tool'}
	<ChatToolRow {item} {run} />
{:else if item.kind === 'file'}
	<div
		class="w-full"
		use:stageEnter={timelineKey(run, item.key)}
		data-message-kind="file"
		data-testid="run-activity-file"
		data-file-path={item.path}
	>
		<FileToolRow verb="Edited" icon="pencil" path={item.path} previewName="current changes to">
			{#snippet preview(relativePath)}
				<EditDiffPreview workstreamId={transcript.workstreamId} path={relativePath} />
			{/snippet}
		</FileToolRow>
	</div>
{:else if item.kind === 'command'}
	<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>
		<BashToolCall
			command={item.command}
			operationName="Shell"
			description={item.description ?? null}
			status="completed"
			output={null}
			error={null}
			exitCode={item.exitCode}
		/>
	</div>
{:else if item.kind === 'approval'}
	<div class="relative w-full" use:stageEnter={timelineKey(run, item.key)}>
		<AgentInteractionCard {item} />
	</div>
{:else if item.kind === 'question'}
	<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>
		<AgentQuestionRow {item} />
	</div>
{:else if item.kind === 'unknown'}
	<div
		class="bg-surface-50 text-2xs text-fg-secondary w-full rounded-md px-2.5 py-2 font-mono select-text"
		use:stageEnter={timelineKey(run, item.key)}
		data-message-kind="unknown"
	>
		unknown: <CodeTokens code={JSON.stringify(item.raw)} language="json" />
	</div>
{/if}
