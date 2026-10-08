<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import {
		NO_LINE_CHANGE_LABEL,
		loadWorkstreamDiffCommand,
		workstreamDiffQuery,
		type DiffFile,
		type WorkstreamDiff,
	} from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { BusyIcon } from '$hyper-ui/icons';
	import DiffViewer from './DiffViewer.svelte';
	import { canonicalChangedPath, changedPathsMatch } from './run-timeline';
	import { relativizeWorkstreamPath } from './workstream-path';

	interface Props {
		workstreamId: string;
		path: string;
		label: string;
	}

	let { workstreamId, path, label }: Props = $props();

	let requested: boolean = $state(false);

	const relativePath = $derived(relativizeWorkstreamPath(path));
	const comparablePath = $derived(canonicalChangedPath(path));
	const diffFor = $derived(workstreamDiffQuery.data);
	const diff = $derived(requested ? diffFor(workstreamId, relativePath) : null);
	const loading = $derived(requested && diff === null);
	const loaded = $derived(diff !== null);
	const preview = $derived(diff ? findPreview(diff) : null);

	function findPreview(result: WorkstreamDiff): DiffFile | null {
		const exact = result.diffByPath[relativePath] ?? result.diffByPath[comparablePath];
		if (exact) return exact;

		return (
			Object.entries(result.diffByPath).find(([candidate]) =>
				changedPathsMatch(canonicalChangedPath(candidate), comparablePath),
			)?.[1] ?? null
		);
	}

	function onOpenChange(open: boolean): void {
		if (!open) return;
		requested = true;
		loadWorkstreamDiffCommand(workstreamId, relativePath);
	}
</script>

<HoverCard
	side="right"
	align="start"
	sideOffset={8}
	openDelay={180}
	closeDelay={180}
	onopenchange={onOpenChange}
	triggerClass="min-w-0 flex-1"
	panelClass="w-[46rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-surface-elevated-border bg-surface-elevated"
	testId="edit-diff-hovercard"
	backdropTestId="edit-diff-hovercard-backdrop"
	owner="agent-chat-diff-preview"
>
	{#snippet trigger({ open })}
		<Button
			bare
			class="text-fg-tertiary hover:bg-surface-150-hover hover:text-fg-secondary focus-visible:bg-surface-150-hover focus-visible:text-fg-secondary focus-visible:ring-border-default/50 min-w-0 flex-1 cursor-default truncate rounded px-0.5 text-left transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
			ariaLabel={`Preview current changes to ${relativePath}`}
			ariaExpanded={open}
			ariaHasPopup="dialog"
			data-testid="edit-diff-preview-trigger"
			onclick={(event) => event.stopPropagation()}
		>
			<SensitiveText text={label} />
		</Button>
	{/snippet}

	{#snippet content()}
		<div
			class="flex h-[28rem] max-h-[calc(100vh-1rem)] min-h-0 flex-col"
			role="dialog"
			tabindex="-1"
			aria-label={`Current changes to ${relativePath}`}
			data-testid="edit-diff-preview-panel"
		>
			<header
				class="border-surface-50-border bg-surface-50 flex h-10 shrink-0 items-center gap-2 border-b px-3"
			>
				<FileTypeIcon path={relativePath} size={14} />
				<div class="min-w-0 flex-1">
					<div class="text-fg-default truncate font-mono text-xs font-medium">{relativePath}</div>
					<div class="text-fg-tertiary text-[10px] leading-none">Current changes</div>
				</div>
				{#if preview?.noLineChange}
					<div class="text-fg-tertiary shrink-0 text-xs" data-testid="edit-diff-preview-summary">
						{NO_LINE_CHANGE_LABEL[preview.noLineChange]}
					</div>
				{:else if preview}
					<div
						class="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums"
						data-testid="edit-diff-preview-summary"
					>
						<span class="text-success-content">+{preview.additions}</span>
						<span class="text-error-content">−{preview.deletions}</span>
					</div>
				{/if}
			</header>

			{#if loading}
				<div
					class="text-fg-tertiary flex min-h-0 flex-1 items-center justify-center gap-2 text-xs"
					role="status"
					data-testid="edit-diff-preview-loading"
				>
					<BusyIcon class="text-fg-tertiary" size={14} />
					Loading current changes…
				</div>
			{:else if loaded && preview}
				<DiffViewer diffText={preview.rawText} selectedPath={relativePath} class="min-h-0 flex-1" />
			{:else if loaded}
				<div
					class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center"
					data-testid="edit-diff-preview-empty"
				>
					<p class="text-fg-secondary text-sm font-medium">Nothing to show for this file</p>
					<p class="text-fg-tertiary max-w-[42ch] text-xs leading-5">
						This workstream has no uncommitted changes for {relativePath} right now.
					</p>
				</div>
			{/if}
		</div>
	{/snippet}
</HoverCard>
