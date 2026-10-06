<script lang="ts">
	import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { newChatRequestId } from '$lib/chat/domain/chat-request';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { formatBytes } from './prompt-editor/prompt-chip-preview';
	import type { ToolImageRead } from './tool-image-read';

	interface Props {
		workstreamId: string | null;
		image: ToolImageRead;
		status: 'running' | 'completed';
		durationLabel: string | null;
	}

	let { workstreamId, image, status, durationLabel }: Props = $props();

	type PreviewState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ready'; src: string }
		| { kind: 'unavailable'; reason: string };

	const previewOwner = newChatRequestId();
	let requested = $state(false);
	const loadedPreview = $derived(imagePreviewQuery.data(previewOwner, image.path));
	const preview = $derived<PreviewState>(
		loadedPreview?.status === 'ready'
			? { kind: 'ready', src: loadedPreview.src }
			: loadedPreview?.status === 'unavailable'
				? { kind: 'unavailable', reason: loadedPreview.reason }
				: requested
					? { kind: 'loading' }
					: { kind: 'idle' },
	);

	const previewable = $derived(image.previewable && workstreamId !== null);

	const meta = $derived(
		[image.bytes === null ? null : formatBytes(image.bytes), image.mediaType]
			.filter(Boolean)
			.join(' · '),
	);

	$effect(() => () => releaseImagePreviewsCommand(previewOwner));

	function loadPreview(): void {
		if (!workstreamId || requested) return;
		requested = true;
		previewWorkstreamImageCommand({ owner: previewOwner, workstreamId, path: image.path });
	}
</script>

<div
	class="text-fg-tertiary flex min-h-6 items-center gap-2"
	data-testid="tool-card-image-read"
	data-tool-status={status}
	data-image-path={image.path}
>
	<span class="w-2.5 shrink-0" aria-hidden="true"></span>
	{#if status === 'running'}
		<BusyIcon class="text-fg-secondary shrink-0" size={13} />
	{:else}
		<Icon name="note" size={14} class="shrink-0" />
	{/if}
	<span class="shrink-0">Read image</span>

	{#snippet chip()}
		<span
			class="border-chip-border bg-chip text-2xs text-fg-secondary inline-flex h-5 max-w-56 min-w-0 cursor-default items-center gap-1 rounded-md border-[0.5px] px-1.5"
			data-testid="tool-image-chip"
		>
			<FileTypeIcon path={image.path} size={12} />
			<span class="truncate">{image.fileName}</span>
		</span>
	{/snippet}

	{#if !previewable}
		{@render chip()}
	{:else}
		<HoverCard
			side="right"
			align="start"
			sideOffset={8}
			openDelay={180}
			closeDelay={150}
			triggerClass="min-w-0"
			onopenchange={(open) => {
				if (open) loadPreview();
			}}
			testId="tool-image-hovercard"
			owner="agent-chat-image-preview"
		>
			{#snippet trigger()}
				{@render chip()}
			{/snippet}

			{#snippet content()}
				<div
					class="border-surface-elevated-border bg-surface-elevated shadow-popup max-w-96 overflow-hidden rounded-lg border-[0.5px] p-2"
					data-testid="tool-image-preview"
					data-preview-state={preview.kind}
				>
					{#if preview.kind === 'ready'}
						<img
							src={preview.src}
							alt={image.fileName}
							class="bg-surface-50 block max-h-64 w-full max-w-80 rounded-md object-contain"
							data-testid="tool-image-preview-image"
						/>
					{:else if preview.kind === 'unavailable'}
						<div
							class="text-2xs text-fg-tertiary max-w-72"
							data-testid="tool-image-preview-refusal"
						>
							{preview.reason}
						</div>
					{:else}
						<div class="text-2xs text-fg-tertiary flex h-20 items-center justify-center gap-2">
							<BusyIcon class="text-fg-tertiary" size={14} />
							Loading preview…
						</div>
					{/if}
					<div class="text-2xs text-fg-default mt-1.5 font-mono break-all">{image.path}</div>
					<div class="text-2xs text-fg-tertiary truncate">{meta}</div>
					{#if image.note}
						<div class="text-2xs text-warning-content mt-1" data-testid="tool-image-note">
							{image.note}
						</div>
					{/if}
				</div>
			{/snippet}
		</HoverCard>
	{/if}

	{#if durationLabel}
		<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums">
			{durationLabel}
		</span>
	{/if}
</div>
