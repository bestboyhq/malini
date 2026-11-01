<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { worktreePageUrl } from '$contract/browser';
	import { mediaKind, mediaPath } from '$lib/chat/domain/turn-report';
	import { Button } from '$hyper-ui/components/button';
	import type { VideoHandoff } from './transcript-gallery';
	import VideoPlayer from './VideoPlayer.svelte';
	import { galleryImageLabel, reportMediaSource } from './workstream-images';

	interface Props {
		src: string;
		label: string;
		workstreamId: string;
		size: 'hero' | 'tile' | 'mini';
		playing?: boolean;
		imagesrc?: ((path: string) => string | null) | undefined;
		caption?: Snippet | undefined;
		onopen?: ((handoff?: VideoHandoff) => void) | undefined;
	}

	let {
		src,
		label,
		workstreamId,
		size,
		playing = true,
		imagesrc,
		caption,
		onopen,
	}: Props = $props();

	const PAGE_WIDTH = 1280;
	const PAGE_HEIGHT = 800;

	const kind = $derived(mediaKind(src));
	const hero = $derived(size === 'hero');
	const fit = $derived(
		hero ? 'absolute inset-0 size-full object-contain' : 'size-full object-cover object-top-left',
	);
	let video = $state<HTMLVideoElement>();
	let pageWidth = $state(0);
	let missingSource = $state<string | null>(null);

	const moving = $derived(playing && !prefersReducedMotion.current);

	$effect(() => {
		if (!video) return;
		if (moving && size === 'tile') void video.play().catch(() => {});
		else video.pause();
	});
</script>

{#if kind === 'page'}
	<span
		class={['block overflow-hidden', hero ? 'absolute inset-0' : 'relative size-full']}
		bind:clientWidth={pageWidth}
	>
		<iframe
			src={worktreePageUrl(workstreamId, src)}
			title={label}
			sandbox="allow-scripts allow-same-origin"
			loading="lazy"
			width={PAGE_WIDTH}
			height={PAGE_HEIGHT}
			inert={!hero}
			class="absolute top-0 left-0 origin-top-left border-0"
			style:transform="scale({pageWidth / PAGE_WIDTH})"
		></iframe>
	</span>
{:else}
	{@const source = reportMediaSource(mediaPath(src), imagesrc)}
	{#if !source}
		<span class={hero ? 'absolute inset-0' : 'block size-full'}></span>
	{:else if kind === 'video' && hero}
		<VideoPlayer
			src={source}
			{label}
			autoplay={moving}
			openLabel={galleryImageLabel(label, kind)}
			{caption}
			{onopen}
		/>
	{:else if kind === 'video'}
		<video
			bind:this={video}
			src={source}
			muted
			loop
			playsinline
			preload="metadata"
			class={fit}
		></video>
	{:else if missingSource === source}
		<span
			role={hero ? 'img' : undefined}
			aria-label={hero ? label : undefined}
			class={[hero ? 'absolute inset-0' : 'block size-full', 'grid place-items-center']}
		>
			{#if hero}
				<span
					class="text-fg-tertiary flex max-w-full min-w-0 flex-col items-center gap-1 px-6 text-xs"
				>
					Picture not found
					<span class="text-2xs max-w-full truncate font-mono">{mediaPath(src)}</span>
				</span>
			{/if}
		</span>
	{:else}
		<img
			src={source}
			alt={hero ? label : ''}
			class={fit}
			onerror={() => (missingSource = source)}
		/>
		{#if hero && onopen}
			<Button
				bare
				class="absolute inset-0 cursor-zoom-in"
				ariaLabel={galleryImageLabel(label, kind)}
				onclick={() => onopen()}
			/>
		{/if}
	{/if}
{/if}
