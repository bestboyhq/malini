<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { newChatRequestId } from '$lib/chat/domain/chat-request';
	import type { ImagePreview } from '$lib/chat/domain/image-preview';
	import { Button } from '$hyper-ui/components/button';
	import { FullPageModal } from '$hyper-ui/components/full-page-modal';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { announceExclusiveOverlayOpen } from '$hyper-ui/overlay';
	import type { GalleryImage } from './transcript-gallery';

	interface Props {
		workstreamId: string;
		images: readonly GalleryImage[];
		startId: string;
		onclose: () => void;
	}

	let { workstreamId, images, startId, onclose }: Props = $props();

	const owner = newChatRequestId();
	let index = $state(
		untrack(() =>
			Math.max(
				0,
				images.findIndex((image) => image.id === startId),
			),
		),
	);
	let direction = $state(1);
	let strip: HTMLDivElement | undefined = $state();
	const previews = $derived(imagePreviewQuery.owned(owner));
	const image = $derived(images[index] ?? null);
	const preview = $derived(image === null ? null : previewOf(image));
	const browsable = $derived(images.length > 1);
	const slideDistance = $derived(prefersReducedMotion.current ? 0 : 96);

	onMount(() => {
		announceExclusiveOverlayOpen();
		// ponytail: reads every image of the chat at open for the thumbnail strip; load on scroll if chats grow to hundreds of images
		for (let step = 0; step < images.length; step++) {
			const target = images[(index + step) % images.length];
			if (target?.kind !== 'workstream') continue;
			previewWorkstreamImageCommand({ owner, workstreamId, path: target.id });
		}
		return () => releaseImagePreviewsCommand(owner);
	});

	$effect(() => {
		strip?.children[index]?.scrollIntoView({
			block: 'nearest',
			inline: 'center',
			behavior: prefersReducedMotion.current ? 'instant' : 'smooth',
		});
	});

	function previewOf(target: GalleryImage): ImagePreview | null {
		return target.kind === 'url'
			? { status: 'ready', src: target.id }
			: (previews[target.id] ?? null);
	}

	function show(next: number, towards: number): void {
		direction = towards;
		index = (next + images.length) % images.length;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || !browsable) return;
		if (event.key === 'ArrowRight') show(index + 1, 1);
		else if (event.key === 'ArrowLeft') show(index - 1, -1);
		else return;
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<FullPageModal open {onclose} ariaLabel="Image gallery">
	<div class="flex h-full w-full flex-col items-center gap-3 pt-14" data-testid="image-gallery">
		<div class="flex min-h-0 w-full flex-1 items-center gap-4">
			{#if browsable}
				<Tooltip content="Previous image" placement="right">
					<IconButton
						variant="secondary"
						size="lg"
						radius="full"
						ariaLabel="Previous image"
						class="pointer-events-auto"
						onclick={() => show(index - 1, -1)}
					>
						<Icon name="chevron-left" size={18} />
					</IconButton>
				</Tooltip>
			{/if}

			<div class="relative h-full min-w-0 flex-1 overflow-hidden">
				{#key image?.id}
					<div
						class="absolute inset-0"
						in:fly={{ x: direction * slideDistance, duration: 260, easing: cubicOut }}
						out:fly={{ x: -direction * slideDistance, duration: 260, easing: cubicOut }}
					>
						{#if image && preview?.status === 'ready'}
							<img
								src={preview.src}
								alt={image.name}
								class="pointer-events-auto absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain"
							/>
						{:else if preview?.status === 'unavailable'}
							<p
								class="border-surface-elevated-border bg-surface-elevated text-fg-secondary pointer-events-auto absolute inset-0 m-auto h-fit w-fit max-w-80 rounded-lg border-[0.5px] px-3 py-2 text-xs wrap-anywhere"
							>
								{preview.reason}
							</p>
						{:else}
							<div
								class="border-surface-elevated-border bg-surface-elevated text-fg-secondary absolute inset-0 m-auto flex h-fit w-fit items-center gap-2 rounded-lg border-[0.5px] px-3 py-2 text-xs"
							>
								<BusyIcon size={14} />
								Loading image…
							</div>
						{/if}
					</div>
				{/key}
			</div>

			{#if browsable}
				<Tooltip content="Next image" placement="left">
					<IconButton
						variant="secondary"
						size="lg"
						radius="full"
						ariaLabel="Next image"
						class="pointer-events-auto"
						onclick={() => show(index + 1, 1)}
					>
						<Icon name="chevron-right" size={18} />
					</IconButton>
				</Tooltip>
			{/if}
		</div>

		{#if image}
			<div
				class="border-surface-elevated-border bg-surface-elevated text-2xs pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full border-[0.5px] px-3 py-1"
			>
				<span class="text-fg-default truncate">{image.name}</span>
				<span class="text-fg-tertiary shrink-0 tabular-nums" role="status">
					{index + 1} of {images.length}
				</span>
			</div>
		{/if}

		{#if browsable}
			<div
				bind:this={strip}
				class="pointer-events-auto flex max-w-full shrink-0 gap-2 overflow-x-auto p-1"
				aria-label="All images"
				role="group"
			>
				{#each images as thumbnail, at (thumbnail.id)}
					{@const thumbnailPreview = previewOf(thumbnail)}
					<Button
						bare
						ariaLabel={`Show image ${thumbnail.name}`}
						ariaCurrent={at === index ? 'true' : 'false'}
						class="border-surface-elevated-border bg-surface-elevated fcc size-14 shrink-0 overflow-hidden rounded-md border-[0.5px] opacity-50 ring-white hover:opacity-100 focus-visible:ring-2 aria-[current=true]:opacity-100 aria-[current=true]:ring-2"
						onclick={() => show(at, Math.sign(at - index))}
					>
						{#if thumbnailPreview?.status === 'ready'}
							<img src={thumbnailPreview.src} alt="" class="size-full object-cover" />
						{:else if thumbnailPreview?.status === 'unavailable'}
							<Icon name="alert" size={16} class="text-fg-tertiary" />
						{:else}
							<BusyIcon size={14} />
						{/if}
					</Button>
				{/each}
			</div>
		{/if}
	</div>
</FullPageModal>
