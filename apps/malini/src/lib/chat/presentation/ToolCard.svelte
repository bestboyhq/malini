<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import EditDiffPreview from './EditDiffPreview.svelte';
	import ExpandMark from './ExpandMark.svelte';
	import ToolImageRow from './ToolImageRow.svelte';
	import { toolImageRead } from './tool-image-read';
	import { toolInputBlocks, toolOutputBlock } from './tool-payload';
	import { editDiffstat } from './edit-diffstat';
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
		workstreamId?: string | null;
		name: string;
		status: 'running' | 'completed';
		waiting?: boolean;
		durationMs: number | null;
		input: unknown;
		output: unknown;
		liveInputJson?: string | null;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let {
		workstreamId = null,
		name,
		status,
		waiting = false,
		durationMs,
		input,
		output,
		liveInputJson = null,
		onopenimage,
	}: Props = $props();
	let expanded = $state(false);

	const isStreamingInput = $derived(
		status === 'running' && input === undefined && liveInputJson !== null,
	);
	const labelInput = $derived(input === undefined ? summarizeLiveToolInput(liveInputJson) : input);
	const displayName = $derived(toolDisplayName(name, labelInput));
	const durationLabel = $derived(
		waiting
			? 'waiting'
			: durationMs === null && status !== 'running'
				? null
				: formatToolDuration(durationMs, status),
	);
	const label = $derived(
		backgroundAgentSummary(name, labelInput, output) ??
			toolActivityLabel(name, labelInput, waiting ? 'completed' : status),
	);
	const actionKind = $derived(toolActionKind(name, labelInput));
	const description = $derived(toolDescriptionLabel(name, labelInput));

	const diffstat = $derived(actionKind === 'edit' ? editDiffstat(labelInput) : null);
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

	const imageRead = $derived(toolImageRead(name, labelInput, output));

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
{:else}
	<details class="group/expand text-sm" data-tool-status={status} bind:open={expanded}>
		<summary
			class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			aria-label={`${expanded ? 'Hide' : 'Show'} input and output for ${displayName}`}
			data-testid="tool-card-summary"
		>
			<ExpandMark live={status === 'running' && !waiting}>
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
			{#if actionKind === 'edit' && workstreamId && editPath}
				<EditDiffPreview {workstreamId} path={editPath} {label} />
			{:else if description}
				<span class="flex min-w-0 flex-1 items-baseline gap-2">
					<span class="text-fg-secondary min-w-0 truncate" data-tool-description>
						<SensitiveText text={description} />
					</span>
					<span class="text-2xs min-w-0 flex-1 truncate font-mono">
						<SensitiveText text={label} />
					</span>
				</span>
			{:else}
				<span class="min-w-0 flex-1 truncate"><SensitiveText text={label} /></span>
			{/if}
			{#if diffstat}
				<span
					class="text-3xs shrink-0 font-mono tabular-nums"
					data-testid="tool-card-diffstat"
					aria-label={`${diffstat.added} lines added, ${diffstat.removed} lines removed`}
				>
					{#if diffstat.added > 0}<span class="text-success-content">+{diffstat.added}</span>{/if}
					{#if diffstat.removed > 0}<span
							class={['text-error-content', diffstat.added > 0 && 'ml-1']}
						>
							−{diffstat.removed}
						</span>{/if}
				</span>
			{/if}
			{#if durationLabel}
				<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums">
					{durationLabel}
				</span>
			{/if}
		</summary>

		{#if expanded}
			<div class="text-2xs mt-1 ml-5.5 grid grid-cols-1 gap-1.5 pb-2">
				{#each inputBlocks as block (block.label)}
					<div>
						<div class="text-fg-tertiary mb-1 text-[10px]">{block.label}</div>
						<pre
							class="styled-scrollbar bg-surface-50 text-2xs text-fg-secondary max-h-52 overflow-auto rounded px-2 py-1.5 font-mono leading-snug whitespace-pre select-text"
							data-testid="tool-card-input"
							data-tool-input-live={isStreamingInput}><CodeTokens
								code={block.code}
								language={block.language}
							/></pre>
					</div>
				{/each}
				<div>
					<div class="text-fg-tertiary mb-1 text-[10px]">{outputBlock.label}</div>
					<pre
						class="styled-scrollbar bg-surface-50 text-2xs text-fg-secondary max-h-52 overflow-auto rounded px-2 py-1.5 font-mono leading-snug whitespace-pre select-text"
						data-tool-output><CodeTokens
							code={outputBlock.code}
							language={outputBlock.language}
						/></pre>
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
