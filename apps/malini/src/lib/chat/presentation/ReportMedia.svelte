<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { worktreePageUrl } from '$contract/browser';
	import { mediaKind, mediaPath } from '$lib/chat/domain/turn-report';
	import { reportMediaSource } from './workstream-images';

	interface Props {
		src: string;
		label: string;
		workstreamId: string;
		size: 'hero' | 'tile' | 'mini';
		playing?: boolean;
		imagesrc?: ((path: string) => string | null) | undefined;
	}

	let { src, label, workstreamId, size, playing = true, imagesrc }: Props = $props();

	const PAGE_WIDTH = 1280;
	const PAGE_HEIGHT = 800;

	const kind = $derived(mediaKind(src));
	const hero = $derived(size === 'hero');
	const fit = $derived(
		hero ? 'absolute inset-0 size-full object-contain' : 'size-full object-cover object-top-left',
	);
	let video = $state<HTMLVideoElement>();
	let pageWidth = $state(0);

	$effect(() => {
		if (!video) return;
		if (playing && size !== 'mini' && !prefersReducedMotion.current)
			void video.play().catch(() => {});
		else video.pause();
	});
</script>

{#if kind === 'page'}
	<span
		class={[
			'relative block overflow-hidden',
			hero ? 'mx-auto aspect-[16/10] w-full max-w-[32rem]' : 'size-full',
		]}
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
	{:else if kind === 'video'}
		<video
			bind:this={video}
			src={source}
			aria-label={hero ? label : undefined}
			muted
			loop
			playsinline
			preload="metadata"
			class={fit}
		></video>
	{:else}
		<img src={source} alt={hero ? label : ''} class={fit} />
	{/if}
{/if}
