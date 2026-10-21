<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { loadFullToolOutputCommand } from '$lib/chat/application/commands/load-full-tool-output.command';
	import { fullToolOutputQuery } from '$lib/chat/application/queries/full-tool-output.query.svelte';
	import type { RunGroup } from '../render-state';
	import BashToolCall from '../BashToolCall.svelte';
	import ToolCard from '../ToolCard.svelte';
	import {
		activityLabelFromTool,
		commandFromTool,
		descriptionFromTool,
		displayNameFromTool,
		durationFromTool,
		failureTextFromTool,
		isCommandTool,
		truncatedOutputLength,
		type ToolItem,
	} from './tool-row-model';
	import { transcriptContext } from './transcript-context';

	interface Props {
		item: ToolItem;
		run: RunGroup;
	}

	let { item, run }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey } = transcript;

	let everCommand = $state(false);
	$effect.pre(() => {
		if (isCommandTool(item)) everCommand = true;
	});
	const drawAsCommand = $derived(everCommand || isCommandTool(item));
	const waiting = $derived(item.tool.status === 'running' && transcript.waitingForUser);
	const blockedReason = $derived(item.tool.autoModeReason ?? null);
	const outputLength = $derived(truncatedOutputLength(item.tool));
	const toolCallId = $derived(item.tool.toolCallId ?? null);
	const fullOutput = $derived(
		toolCallId === null ? null : fullToolOutputQuery.data(transcript.sessionId, toolCallId),
	);

	function loadFullOutput(): void {
		if (toolCallId !== null) loadFullToolOutputCommand(transcript.sessionId, toolCallId);
	}
</script>

{#if drawAsCommand}
	<div class="w-full" use:stageEnter={timelineKey(run, item.tool.toolCallId ?? item.key)}>
		<BashToolCall
			command={commandFromTool(item) ?? displayNameFromTool(item)}
			operationName={displayNameFromTool(item)}
			description={descriptionFromTool(item)}
			status={item.tool.status}
			{waiting}
			output={item.tool.output}
			error={item.tool.error ?? null}
			{blockedReason}
			{outputLength}
			{fullOutput}
			onloadfulloutput={toolCallId === null ? undefined : loadFullOutput}
		/>
	</div>
{:else}
	<div
		class="w-full"
		use:stageEnter={timelineKey(run, item.tool.toolCallId ?? item.key)}
		data-message-kind="tool"
		data-tool-status={item.tool.status}
	>
		{#if item.tool.status === 'failed' && blockedReason === null}
			<div
				class="bg-error flex items-start gap-2 rounded-md px-2.5 py-2 text-xs"
				data-testid="tool-card-failed"
			>
				<span
					class="bg-error-content/15 text-error-content mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
				>
					<Icon name="close" size={10} />
				</span>
				<div class="min-w-0 flex-1">
					<div class="text-error-content font-mono text-xs font-medium">
						{activityLabelFromTool(item)}
					</div>
					<p
						class="text-2xs text-error-content/85 mt-0.5 leading-relaxed break-words whitespace-pre-wrap select-text"
						data-testid="tool-card-error-text"
					>
						{failureTextFromTool(item)}
					</p>
				</div>
				<Tooltip
					content={transcript.copiedErrorKey === item.key ? 'Copied' : 'Copy full error'}
					placement="top"
				>
					<IconButton
						bare
						class="text-error-content/70 hover:bg-error-content/10 hover:text-error-content focus-visible:ring-error-content/30 grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
						ariaLabel={`Copy ${displayNameFromTool(item)} error`}
						onclick={() => transcript.copyErrorText(item.key, failureTextFromTool(item))}
					>
						<Icon name="copy" size={12} />
					</IconButton>
				</Tooltip>
			</div>
		{:else}
			<ToolCard
				workstreamId={transcript.workstreamId}
				name={item.tool.name}
				status={item.tool.status === 'running' ? 'running' : 'completed'}
				{waiting}
				durationMs={durationFromTool(item.tool)}
				input={item.tool.input}
				output={blockedReason === null ? item.tool.output : item.tool.error}
				{blockedReason}
				liveInputJson={item.tool.status === 'running'
					? transcript.liveInputJsonForRunningTool(run.runId, item.tool)
					: null}
				onopenimage={transcript.openImageGallery}
				{outputLength}
				{fullOutput}
				onloadfulloutput={toolCallId === null ? undefined : loadFullOutput}
			/>
		{/if}
	</div>
{/if}
