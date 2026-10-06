<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import CodeTokens from './CodeTokens.svelte';
	import EditDiffPreview from './EditDiffPreview.svelte';
	import ToolImageRow from './ToolImageRow.svelte';
	import { toolImageRead } from './tool-image-read';
	import { editDiffstat } from './edit-diffstat';
	import { formatToolDuration } from './render-state';
	import { relativizeWorkstreamPath } from './workstream-path';
	import {
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
	}: Props = $props();
	let expanded = $state(false);

	const isStreamingInput = $derived(
		status === 'running' && input === undefined && liveInputJson !== null,
	);
	const inputText = $derived(
		isStreamingInput
			? truncateLiveJson(liveInputJson ?? '')
			: formatValue(sanitizeManagedPaths(input)),
	);
	const outputText = $derived(formatValue(sanitizeManagedPaths(output)));
	const labelInput = $derived(input === undefined ? summarizeLiveToolInput(liveInputJson) : input);
	const displayName = $derived(toolDisplayName(name, labelInput));
	const durationLabel = $derived(
		waiting
			? 'waiting'
			: durationMs === null && status !== 'running'
				? null
				: formatToolDuration(durationMs, status),
	);
	const label = $derived(toolActivityLabel(name, labelInput, waiting ? 'completed' : status));
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

	const typedPath = $derived(
		editPath && (actionKind === 'edit' || actionKind === 'read') ? editPath : null,
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

	function formatValue(value: unknown): string {
		if (value === undefined) return '(not provided)';
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
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
		<ToolImageRow {workstreamId} image={imageRead} {status} {durationLabel} />
	</div>
{:else}
	<details class="group/tool text-sm" data-tool-status={status} bind:open={expanded}>
		<summary
			class="text-fg-secondary hover:text-fg-default flex min-h-6 cursor-pointer list-none items-center gap-2 transition-colors"
			aria-label={`${expanded ? 'Hide' : 'Show'} input and output for ${displayName}`}
			data-testid="tool-card-summary"
		>
			<Icon
				name="chevron-right"
				size={10}
				class="shrink-0 transition-transform duration-150 group-open/tool:rotate-90"
			/>
			<span
				class={[
					'grid h-3.5 w-3.5 shrink-0 place-items-center',
					status === 'running' && !waiting && 'tool-mark-live text-fg-default',
				]}
				aria-hidden="true"
			>
				{#if typedPath}
					<FileTypeIcon path={typedPath} size={13} testId="tool-card-file-icon" />
				{:else if actionKind === 'edit'}
					<Icon name="pencil" class="text-fg-tertiary shrink-0" size={13} />
				{:else if actionKind === 'command'}
					<Icon name="terminal" size={14} class="shrink-0" />
				{:else if actionKind === 'read'}
					<Icon name="note" size={14} class="shrink-0" />
				{:else if actionKind === 'search'}
					<Icon name="search" size={14} class="shrink-0" />
				{:else}
					<Icon name="wrench" size={14} class="shrink-0" />
				{/if}
			</span>
			{#if actionKind === 'edit' && workstreamId && editPath}
				<EditDiffPreview {workstreamId} path={editPath} {label} />
			{:else if description}
				<span class="flex min-w-0 flex-1 items-baseline gap-2">
					<span class="text-fg-default min-w-0 truncate" data-tool-description>
						<SensitiveText text={description} />
					</span>
					<span class="text-2xs text-fg-tertiary min-w-0 flex-1 truncate font-mono">
						<SensitiveText text={label} />
					</span>
				</span>
			{:else}
				<span class="text-fg-default min-w-0 flex-1 truncate"><SensitiveText text={label} /></span>
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
			<div class="text-2xs mt-1 ml-5 grid gap-1.5 pb-2">
				<div>
					<div class="text-fg-tertiary mb-1 text-[10px]">Input</div>
					<pre
						class="styled-scrollbar bg-surface-50 text-2xs text-fg-secondary max-h-52 overflow-auto rounded px-2 py-1.5 font-mono leading-snug whitespace-pre select-text"
						data-testid="tool-card-json"
						data-tool-input-live={isStreamingInput}><CodeTokens
							code={inputText}
							language="json"
						/></pre>
				</div>
				<div>
					<div class="text-fg-tertiary mb-1 text-[10px]">Output</div>
					<pre
						class="styled-scrollbar bg-surface-50 text-2xs text-fg-secondary max-h-52 overflow-auto rounded px-2 py-1.5 font-mono leading-snug whitespace-pre select-text"
						data-tool-output><CodeTokens code={outputText} language="json" /></pre>
				</div>
			</div>
		{/if}
	</details>
{/if}

<style>
	summary::-webkit-details-marker {
		display: none;
	}

	:global(.tool-mark-live) {
		animation: tool-mark-breathe 1.6s ease-in-out infinite;
	}

	@keyframes tool-mark-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.tool-mark-live) {
			animation: none;
		}
	}
</style>
