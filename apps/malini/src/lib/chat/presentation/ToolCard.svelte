<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Icon } from '$hyper-ui/icons';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import DiffViewer from './DiffViewer.svelte';
	import EditDiffPreview from './EditDiffPreview.svelte';
	import FilePreviewHeader from './FilePreviewHeader.svelte';
	import ExpandMark from './ExpandMark.svelte';
	import FileToolRow from './FileToolRow.svelte';
	import ReadFilePreview from './ReadFilePreview.svelte';
	import ToolImageRow from './ToolImageRow.svelte';
	import ToolLabel from './ToolLabel.svelte';
	import ToolOutputText from './ToolOutputText.svelte';
	import type { FullToolOutput } from '$lib/chat/domain/full-tool-output';
	import { toolImageRead } from './tool-image-read';
	import { toolInputBlocks, toolOutputBlock } from './tool-payload';
	import { editDiffstat, editHunks } from './edit-diffstat';
	import { formatToolDuration } from './render-state';
	import { relativizeWorkstreamPath } from './workstream-path';
	import {
		backgroundAgentSummary,
		summarizeLiveToolInput,
		toolActionKind,
		toolActivityLabel,
		toolDescriptionLabel,
		toolDisplayName,
	} from './tool-display-name';

	interface Props {
		workstreamId: string;
		name: string;
		status: 'running' | 'completed';
		waiting?: boolean;
		durationMs: number | null;
		input: unknown;
		output: unknown;
		liveInputJson?: string | null;
		onopenimage?: ((id: string) => void) | undefined;
		outputLength?: number | null;
		fullOutput?: FullToolOutput | null;
		onloadfulloutput?: (() => void) | undefined;
		blockedReason?: string | null;
	}

	let {
		workstreamId,
		name,
		status,
		waiting = false,
		durationMs,
		input,
		output,
		liveInputJson = null,
		onopenimage,
		outputLength = null,
		fullOutput = null,
		onloadfulloutput,
		blockedReason = null,
	}: Props = $props();
	let expanded = $state(false);
	let contentMounted = $state(false);

	const isStreamingInput = $derived(
		status === 'running' && input === undefined && liveInputJson !== null,
	);
	const labelInput = $derived(input === undefined ? summarizeLiveToolInput(liveInputJson) : input);
	const displayName = $derived(toolDisplayName(name, labelInput));
	const durationLabel = $derived(
		waiting
			? 'waiting'
			: status === 'running' || durationMs === null
				? null
				: formatToolDuration(durationMs),
	);
	const label = $derived(
		backgroundAgentSummary(name, labelInput, output) ?? toolActivityLabel(name, labelInput),
	);
	const actionKind = $derived(toolActionKind(name, labelInput));
	const description = $derived(toolDescriptionLabel(name, labelInput));

	const diffstat = $derived(actionKind === 'edit' ? editDiffstat(labelInput) : null);
	const editChange = $derived(actionKind === 'edit' ? editHunks(labelInput) : []);
	const writtenFile = $derived(
		actionKind === 'edit' && isRecord(labelInput) && typeof labelInput['content'] === 'string'
			? numberedLines(labelInput['content'])
			: null,
	);
	const previewName = $derived(
		actionKind === 'read' || (editChange.length === 0 && writtenFile !== null)
			? 'contents of'
			: editChange.length > 0
				? 'changes to'
				: 'current changes to',
	);
	const editPath = $derived(
		stringAt(labelInput, [
			'file_path',
			'path',
			'filePath',
			'file',
			'filename',
			'notebook_path',
			'notebookPath',
		]),
	);

	const inputBlocks = $derived(
		isStreamingInput
			? [{ label: 'Input', code: truncateLiveJson(liveInputJson ?? ''), language: 'json' }]
			: toolInputBlocks(sanitizeManagedPaths(input), editPath),
	);
	const outputBlock = $derived(
		toolOutputBlock(sanitizeManagedPaths(output), editPath, actionKind === 'read'),
	);

	const imageRead = $derived(toolImageRead(name, labelInput, output, workstreamId));

	function stringAt(value: unknown, keys: readonly string[]): string | null {
		if (!isRecord(value)) return null;
		for (const key of keys) {
			const candidate = value[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
		return null;
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null;
	}

	function numberedLines(text: string): string {
		return text
			.replace(/\n$/u, '')
			.split('\n')
			.map((line, index) => `${index + 1}\t${line}`)
			.join('\n');
	}

	const LIVE_JSON_TRUNCATE_LENGTH = 2_000;

	function truncateLiveJson(json: string): string {
		return json.length <= LIVE_JSON_TRUNCATE_LENGTH
			? json
			: `${json.slice(0, LIVE_JSON_TRUNCATE_LENGTH)}…`;
	}

	function sanitizeManagedPaths(value: unknown): unknown {
		if (typeof value === 'string') return relativizeWorkstreamPath(value);
		if (Array.isArray(value)) return value.map((entry) => sanitizeManagedPaths(entry));
		if (isRecord(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [key, sanitizeManagedPaths(entry)]),
			);
		}
		return value;
	}
</script>

{#if imageRead}
	<div class="text-sm">
		<ToolImageRow {workstreamId} image={imageRead} {status} {durationLabel} {onopenimage} />
	</div>
{:else if editPath && blockedReason === null && (actionKind === 'edit' || actionKind === 'read')}
	<FileToolRow
		verb={displayName}
		icon={actionKind === 'edit' ? 'pencil' : 'note'}
		path={editPath}
		{previewName}
		{diffstat}
		{durationLabel}
	>
		{#snippet preview(relativePath)}
			{#if actionKind === 'read'}
				<ReadFilePreview
					path={relativePath}
					{output}
					fullLength={outputLength}
					{fullOutput}
					onloadfull={onloadfulloutput}
				/>
			{:else if editChange.length > 0}
				<section aria-label={`Changes to ${relativePath}`} data-testid="edit-change-preview">
					<FilePreviewHeader path={relativePath} />
					<DiffViewer hunks={editChange} path={relativePath} />
				</section>
			{:else if writtenFile !== null}
				<ReadFilePreview path={relativePath} output={writtenFile} />
			{:else}
				<EditDiffPreview {workstreamId} path={relativePath} />
			{/if}
		{/snippet}
	</FileToolRow>
{:else}
	<details class="group/expand text-sm" data-tool-status={status} bind:open={expanded}>
		<summary
			class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			aria-label={`${expanded ? 'Hide' : 'Show'} input and output for ${displayName}`}
			data-testid="tool-card-summary"
			onclick={() => (contentMounted = true)}
		>
			<ExpandMark>
				{#if actionKind === 'edit'}
					<Icon name="pencil" class="shrink-0" size={13} />
				{:else if actionKind === 'command'}
					<Icon name="terminal" size={14} class="shrink-0" />
				{:else if actionKind === 'read'}
					<Icon name="note" size={14} class="shrink-0" />
				{:else if actionKind === 'search'}
					<Icon name="search" size={14} class="shrink-0" />
				{:else}
					<Icon name="wrench" size={14} class="shrink-0" />
				{/if}
			</ExpandMark>
			<ToolLabel
				title={description ?? label}
				detail={description ? label : null}
				emphasized={description !== null}
			/>
			{#if blockedReason}
				<span
					class="text-3xs text-fg-tertiary/70 shrink-0 font-mono"
					data-testid="tool-blocked"
					in:fade={{ duration: 190 }}
				>
					blocked · {blockedReason}
				</span>
			{:else if durationLabel}
				<span
					class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums"
					in:fade={{ duration: 190 }}
				>
					{durationLabel}
				</span>
			{/if}
		</summary>

		{#if contentMounted}
			<div class="text-2xs mt-1 ml-5.5 grid grid-cols-1 gap-1.5 pb-2">
				{#each inputBlocks as block (block.label)}
					<div>
						<div class="text-fg-tertiary mb-1 text-[10px]">{block.label}</div>
						<ScrollableDiv
							orientation="xy"
							class="bg-surface-50 max-h-52 rounded"
							viewportClass="max-h-52"
						>
							<div data-testid="tool-card-input" data-tool-input-live={isStreamingInput}>
								<ToolOutputText
									text={block.code}
									language={block.language}
									class="text-2xs text-fg-secondary m-0 min-w-max px-2 pt-1.5 font-mono leading-snug whitespace-pre select-text"
									endClass="pb-1.5"
								/>
							</div>
						</ScrollableDiv>
					</div>
				{/each}
				<div>
					<div class="text-fg-tertiary mb-1 text-[10px]">{outputBlock.label}</div>
					<ScrollableDiv
						orientation="xy"
						class="bg-surface-50 max-h-52 rounded"
						viewportClass="max-h-52"
					>
						<div data-tool-output>
							<ToolOutputText
								text={outputBlock.code}
								language={outputBlock.language}
								class="text-2xs text-fg-secondary m-0 min-w-max px-2 pt-1.5 font-mono leading-snug whitespace-pre select-text"
								endClass="pb-1.5"
								fullLength={outputLength}
								{fullOutput}
								onloadfull={onloadfulloutput}
							/>
						</div>
					</ScrollableDiv>
				</div>
			</div>
		{/if}
	</details>
{/if}

<style>
	summary::-webkit-details-marker {
		display: none;
	}
</style>
