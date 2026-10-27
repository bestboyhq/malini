<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { on } from 'svelte/events';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly, type TransitionConfig } from 'svelte/transition';
	import {
		explainUnavailableImageCommand,
		previewWorkstreamImageCommand,
	} from '$lib/chat/application/commands/preview-workstream-image.command';
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
	import VideoPlayer from './VideoPlayer.svelte';

	interface Props {
		workstreamId: string;
		images: readonly GalleryImage[];
		startId: string;
		onclose: () => void;
	}

	interface Point {
		x: number;
		y: number;
	}

	interface Drag {
		start: Point;
		from: Point;
		moved: boolean;
	}

	const MAX_ZOOM = 8;
	const ZOOM_STEP = 1.5;
	const DRAG_SLOP_PX = 3;
	const CENTER: Point = { x: 0, y: 0 };

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
	let zoom = $state(1);
	let pan: Point = $state(CENTER);
	let drag: Drag | null = $state(null);
	let gliding = $state(false);
	let strip: HTMLDivElement | undefined = $state();
	let stage: HTMLDivElement | undefined = $state();
	let picture: HTMLImageElement | undefined = $state();
	let modal: FullPageModal | undefined = $state();
	let player: VideoPlayer | undefined = $state();
	let stripPlaced = false;
	let stripShown = $state(false);
	const previews = $derived(imagePreviewQuery.owned(owner));
	const image = $derived(images[index] ?? null);
	const preview = $derived(image === null ? null : previewOf(image));
	const browsable = $derived(images.length > 1);
	const zoomable = $derived(preview?.status === 'ready' && image?.media === 'image');
	const zoomed = $derived(zoom > 1);
	const zoomLabel = $derived(zoomed ? `${Number(zoom.toFixed(1))}×` : 'Fit');
	const travel = $derived(prefersReducedMotion.current ? 0 : 1);
	const slideDistance = $derived(40 * travel);
	const opener =
		document.activeElement instanceof HTMLElement && document.activeElement !== document.body
			? document.activeElement.getBoundingClientRect()
			: null;

	onMount(() => {
		announceExclusiveOverlayOpen();
		// ponytail: reads every image of the chat at open for the thumbnail strip; load on scroll if chats grow to hundreds of images
		for (let step = 0; step < images.length; step++) {
			const target = images[(index + step) % images.length];
			if (target?.kind !== 'workstream') continue;
			previewWorkstreamImageCommand({ owner, workstreamId, path: target.id });
		}
		const stopWheel = on(window, 'wheel', onWheel, { passive: false });
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => (stripShown = true));
		});
		return () => {
			cancelAnimationFrame(frame);
			stopWheel();
			releaseImagePreviewsCommand(owner);
		};
	});

	$effect(() => {
		const thumbnail = strip?.children[index];
		if (!strip || !(thumbnail instanceof HTMLElement)) return;
		strip.scrollTo({
			left: thumbnail.offsetLeft - (strip.clientWidth - thumbnail.offsetWidth) / 2,
			behavior: stripPlaced && !prefersReducedMotion.current ? 'smooth' : 'instant',
		});
		stripPlaced = true;
	});

	function grow(node: Element): TransitionConfig {
		const box = node.getBoundingClientRect();
		const origin = opener
			? `${opener.left + opener.width / 2 - box.left}px ${opener.top + opener.height / 2 - box.top}px`
			: 'center';
		const start = 1 - 0.06 * travel;
		return {
			duration: 220,
			easing: quintOut,
			css: (t) =>
				`transform-origin: ${origin}; transform: scale(${start + (1 - start) * t}); opacity: ${t};`,
		};
	}

	function slideIn(_node: Element, { x }: { x: number }): TransitionConfig {
		return {
			duration: 200,
			easing: quintOut,
			css: (_t, u) => `transform: translateX(${x * u}px);`,
		};
	}

	function explainUnavailable(target: GalleryImage): void {
		if (target.kind !== 'workstream') return;
		explainUnavailableImageCommand({ owner, workstreamId, path: target.id });
	}

	function previewOf(target: GalleryImage): ImagePreview | null {
		return target.kind === 'url'
			? { status: 'ready', src: target.id }
			: (previews[target.id] ?? null);
	}

	function show(next: number, towards: number): void {
		direction = towards;
		index = (next + images.length) % images.length;
		zoom = 1;
		pan = CENTER;
		drag = null;
	}

	function within(value: number, low: number, high: number): number {
		return Math.min(high, Math.max(low, value));
	}

	function bounded(offset: Point): Point {
		const spareX = Math.max(
			0,
			((picture?.offsetWidth ?? 0) * zoom - (stage?.clientWidth ?? 0)) / 2,
		);
		const spareY = Math.max(
			0,
			((picture?.offsetHeight ?? 0) * zoom - (stage?.clientHeight ?? 0)) / 2,
		);
		return { x: within(offset.x, -spareX, spareX), y: within(offset.y, -spareY, spareY) };
	}

	function zoomTo(next: number, focus: Point = CENTER): void {
		const target = within(next, 1, MAX_ZOOM);
		const ratio = target / zoom;
		zoom = target;
		pan = bounded({
			x: focus.x - (focus.x - pan.x) * ratio,
			y: focus.y - (focus.y - pan.y) * ratio,
		});
	}

	function glideTo(next: number, focus: Point = CENTER): void {
		gliding = true;
		zoomTo(next, focus);
	}

	function stagePoint(event: MouseEvent): Point {
		const box = stage?.getBoundingClientRect();
		if (!box) return CENTER;
		return {
			x: event.clientX - box.left - box.width / 2,
			y: event.clientY - box.top - box.height / 2,
		};
	}

	function onWheel(event: WheelEvent): void {
		if (!zoomable) return;
		const pinch = event.ctrlKey || event.metaKey;
		const overStrip = event.target instanceof Node && strip?.contains(event.target);
		if (!pinch && (!zoomed || overStrip)) return;
		event.preventDefault();
		gliding = false;
		if (pinch) zoomTo(zoom * Math.exp(-within(event.deltaY, -25, 25) / 100), stagePoint(event));
		else pan = bounded({ x: pan.x - event.deltaX, y: pan.y - event.deltaY });
	}

	function onPointerDown(
		event: PointerEvent & { currentTarget: EventTarget & HTMLImageElement },
	): void {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = { start: { x: event.clientX, y: event.clientY }, from: pan, moved: false };
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag) return;
		const dx = event.clientX - drag.start.x;
		const dy = event.clientY - drag.start.y;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
		drag.moved = true;
		if (!zoomed) return;
		gliding = false;
		pan = bounded({ x: drag.from.x + dx, y: drag.from.y + dy });
	}

	function onPointerUp(): void {
		const tapped = drag?.moved === false;
		drag = null;
		if (tapped) modal?.close();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === ' ' && image?.media === 'video') {
			if (event.target instanceof HTMLButtonElement) return;
			player?.toggle();
		} else if (event.key === 'ArrowRight' && browsable) show(index + 1, 1);
		else if (event.key === 'ArrowLeft' && browsable) show(index - 1, -1);
		else if ((event.key === '+' || event.key === '=') && zoomable) glideTo(zoom * ZOOM_STEP);
		else if (event.key === '-' && zoomable) glideTo(zoom / ZOOM_STEP);
		else if (event.key === '0' && zoomable) glideTo(1);
		else return;
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet arrow(label: string, glyph: 'chevron-left' | 'chevron-right', towards: number)}
	<Tooltip content={label} placement={towards < 0 ? 'right' : 'left'}>
		<Button
			bare
			ariaLabel={label}
			class="fcc pointer-events-auto h-24 w-14 rounded-md text-white/60 ring-white transition-[color] hover:text-white focus-visible:text-white focus-visible:ring-2"
			onclick={() => show(index + towards, towards)}
		>
			<Icon name={glyph} size={40} />
		</Button>
	</Tooltip>
{/snippet}

<FullPageModal bind:this={modal} open {onclose} ariaLabel="Image gallery">
	<div class="flex h-full w-full flex-col items-center gap-3 pt-14" data-testid="image-gallery">
		<div class="flex min-h-0 w-full flex-1 items-center gap-4">
			{#if browsable}
				<div in:fly|global={{ x: -8 * travel, duration: 200, easing: quintOut }}>
					{@render arrow('Previous image', 'chevron-left', -1)}
				</div>
			{/if}

			<div
				bind:this={stage}
				class="relative h-full min-w-0 flex-1 overflow-hidden rounded-md"
				in:grow|global
			>
				{#key image?.id}
					<div class="absolute inset-0" in:slideIn={{ x: direction * slideDistance }}>
						{#if image?.media === 'video' && preview?.status === 'ready'}
							<div class="absolute inset-0" in:fade={{ duration: 150 }}>
								<VideoPlayer
									bind:this={player}
									src={preview.src}
									label={image.name}
									autoplay={!prefersReducedMotion.current}
									autohide
									onerror={() => explainUnavailable(image)}
								/>
							</div>
						{:else if image && preview?.status === 'ready'}
							<img
								bind:this={picture}
								src={preview.src}
								alt={image.name}
								draggable="false"
								decoding="async"
								fetchpriority="high"
								onerror={() => explainUnavailable(image)}
								data-workstream-image={image.kind === 'workstream' ? image.id : undefined}
								class={[
									'pointer-events-auto absolute inset-0 m-auto max-h-full max-w-full touch-none rounded-md object-contain select-none',
									zoomed && (drag?.moved ? 'cursor-grabbing' : 'cursor-grab'),
									gliding &&
										'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
								]}
								style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})"
								in:fade={{ duration: 150 }}
								onpointerdown={onPointerDown}
								onpointermove={onPointerMove}
								onpointerup={onPointerUp}
								onpointercancel={() => (drag = null)}
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
								Loading {image?.media ?? 'image'}…
							</div>
						{/if}
					</div>
				{/key}
			</div>

			{#if browsable}
				<div in:fly|global={{ x: 8 * travel, duration: 200, easing: quintOut }}>
					{@render arrow('Next image', 'chevron-right', 1)}
				</div>
			{/if}
		</div>

		{#if image}
			<div
				class="border-surface-elevated-border bg-surface-elevated text-2xs pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full border-[0.5px] py-0.5 pr-0.5 pl-3"
				in:fly|global={{ y: 6 * travel, duration: 200, easing: quintOut }}
			>
				<span class="text-fg-default truncate">{image.name}</span>
				<span class="text-fg-tertiary shrink-0 tabular-nums" role="status">
					{index + 1} of {images.length}
				</span>
				<div
					class="border-surface-elevated-border flex shrink-0 items-center border-l-[0.5px] pl-0.5"
					role="group"
					aria-label="Zoom"
				>
					<Tooltip content="Zoom out (-)" placement="top">
						<IconButton
							variant="ghost"
							size="xs"
							radius="full"
							ariaLabel="Zoom out"
							disabled={!zoomable || !zoomed}
							onclick={() => glideTo(zoom / ZOOM_STEP)}
						>
							<Icon name="minus" size={12} />
						</IconButton>
					</Tooltip>
					<Tooltip content="Fit to screen (0)" placement="top">
						<Button
							variant="ghost"
							size="xs"
							radius="full"
							ariaLabel={zoomed ? `Fit to screen from ${zoomLabel}` : 'Fit to screen'}
							disabled={!zoomable || !zoomed}
							class="min-w-9 justify-center tabular-nums"
							onclick={() => glideTo(1)}
						>
							{zoomLabel}
						</Button>
					</Tooltip>
					<Tooltip content="Zoom in (+)" placement="top">
						<IconButton
							variant="ghost"
							size="xs"
							radius="full"
							ariaLabel="Zoom in"
							disabled={!zoomable || zoom >= MAX_ZOOM}
							onclick={() => glideTo(zoom * ZOOM_STEP)}
						>
							<Icon name="plus" size={12} />
						</IconButton>
					</Tooltip>
				</div>
			</div>
		{/if}

		{#if browsable && stripShown}
			<div
				bind:this={strip}
				class="pointer-events-auto relative flex max-w-full shrink-0 gap-1 overflow-x-auto overflow-y-hidden p-0.5"
				aria-label="All images"
				role="group"
				in:fly|global={{ y: 8 * travel, duration: 200, easing: quintOut }}
			>
				{#each images as thumbnail, at (thumbnail.id)}
					{@const thumbnailPreview = previewOf(thumbnail)}
					<div
						class="shrink-0 p-0.5 [contain-intrinsic-size:auto_3.75rem] [content-visibility:auto]"
					>
						<Button
							bare
							ariaLabel={`Show ${thumbnail.media} ${thumbnail.name}`}
							ariaCurrent={at === index ? 'true' : 'false'}
							class="border-surface-elevated-border bg-surface-elevated fcc relative size-14 overflow-hidden rounded-md border-[0.5px] opacity-50 ring-white hover:opacity-100 focus-visible:ring-2 aria-[current=true]:opacity-100 aria-[current=true]:ring-2"
							onclick={() => show(at, Math.sign(at - index))}
						>
							{#if thumbnail.media === 'video' && thumbnailPreview?.status === 'ready'}
								<video
									src={thumbnailPreview.src}
									class="size-full object-cover"
									preload="metadata"
									muted
									playsinline
									aria-hidden="true"
									onerror={() => explainUnavailable(thumbnail)}
								></video>
								<span
									class="border-surface-elevated-border bg-surface-elevated/80 text-fg-default fcc absolute size-6 rounded-full border-[0.5px]"
								>
									<Icon name="play" size={12} />
								</span>
							{:else if thumbnailPreview?.status === 'ready'}
								<img
									src={thumbnailPreview.src}
									alt=""
									class="size-full object-cover"
									loading="lazy"
									decoding="async"
									fetchpriority="low"
									onerror={() => explainUnavailable(thumbnail)}
									data-workstream-image={thumbnail.kind === 'workstream' ? thumbnail.id : undefined}
								/>
							{:else if thumbnailPreview?.status === 'unavailable'}
								<Icon name="alert" size={16} class="text-fg-tertiary" />
							{:else}
								<BusyIcon size={14} />
							{/if}
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</FullPageModal>
