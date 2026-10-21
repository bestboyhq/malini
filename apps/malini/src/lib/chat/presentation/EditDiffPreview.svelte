<script lang="ts">
	import { onMount } from 'svelte';
	import {
		NO_LINE_CHANGE_LABEL,
		loadWorkstreamDiffCommand,
		workstreamDiffQuery,
		type DiffFile,
		type WorkstreamDiff,
	} from '$shared/repositories/repositories.api';
	import { BusyIcon } from '$hyper-ui/icons';
	import DiffViewer from './DiffViewer.svelte';
	import FilePreviewHeader from './FilePreviewHeader.svelte';
	import { canonicalChangedPath, changedPathsMatch } from './run-timeline';

	interface Props {
		workstreamId: string;
		path: string;
	}

	let { workstreamId, path }: Props = $props();

	const comparablePath = $derived(canonicalChangedPath(path));
	const diffFor = $derived(workstreamDiffQuery.data);
	const diff = $derived(diffFor(workstreamId, path));
	const preview = $derived(diff ? findPreview(diff) : null);

	onMount(() => loadWorkstreamDiffCommand(workstreamId, path));

	function findPreview(result: WorkstreamDiff): DiffFile | null {
		const exact = result.diffByPath[path] ?? result.diffByPath[comparablePath];
		if (exact) return exact;

		return (
			Object.entries(result.diffByPath).find(([candidate]) =>
				changedPathsMatch(canonicalChangedPath(candidate), comparablePath),
			)?.[1] ?? null
		);
	}
</script>

<section aria-label={`Current changes to ${path}`} data-testid="edit-diff-preview-panel">
	<FilePreviewHeader {path}>
		<span class="text-3xs text-fg-tertiary shrink-0">Current changes</span>
		{#if preview?.noLineChange}
			<span class="text-3xs text-fg-tertiary shrink-0" data-testid="edit-diff-preview-summary">
				{NO_LINE_CHANGE_LABEL[preview.noLineChange]}
			</span>
		{:else if preview}
			<span
				class="text-3xs flex shrink-0 items-center gap-1 font-mono tabular-nums"
				data-testid="edit-diff-preview-summary"
			>
				<span class="text-success-content">+{preview.additions}</span>
				<span class="text-error-content">−{preview.deletions}</span>
			</span>
		{/if}
	</FilePreviewHeader>

	{#if diff === null}
		<div
			class="text-2xs text-fg-tertiary flex items-center gap-2 px-2.5 py-3"
			role="status"
			data-testid="edit-diff-preview-loading"
		>
			<BusyIcon class="text-fg-tertiary" size={12} />
			Loading current changes…
		</div>
	{:else if preview && preview.hunks.length > 0}
		<DiffViewer hunks={preview.hunks} {path} />
	{:else if preview}
		<p class="text-2xs text-fg-tertiary px-2.5 py-3">
			{preview.noLineChange === 'binary'
				? 'Binary file - its contents are not shown.'
				: 'No textual diff available.'}
		</p>
	{:else}
		<p class="text-2xs text-fg-tertiary px-2.5 py-3" data-testid="edit-diff-preview-empty">
			Nothing to show for this file: the workstream has no uncommitted changes to it right now.
		</p>
	{/if}
</section>
