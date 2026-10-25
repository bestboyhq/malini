<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { worktreePageUrl } from '$contract/browser';
	import { mediaKind, mediaPath, type TurnVariant } from '$lib/chat/domain/turn-report';
	import { variantLabel } from '$lib/chat/domain/variant-pick';
	import { reportMediaSource } from './workstream-images';

	interface Props {
		variant: TurnVariant;
		workstreamId: string;
		size: 'hero' | 'tile' | 'mini';
		playing?: boolean;
		imagesrc?: ((path: string) => string | null) | undefined;
	}

	let { variant, workstreamId, size, playing = true, imagesrc }: Props = $props();

	const PAGE_WIDTH = 1280;
	const PAGE_HEIGHT = 800;

	const kind = $derived(mediaKind(variant.src));
	const label = $derived(`Variant ${variantLabel(variant)}`);
	const hero = $derived(size === 'hero');
	const fit = $derived(
		hero ? 'mx-auto block max-h-[28rem] max-w-full' : 'size-full object-cover object-top-left',
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
		class={['relative block overflow-hidden', hero ? 'aspect-[16/10] w-full' : 'size-full']}
		bind:clientWidth={pageWidth}
	>
		<iframe
			src={worktreePageUrl(workstreamId, variant.src)}
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
	{@const src = reportMediaSource(mediaPath(variant.src), imagesrc)}
	{#if !src}
		<span class={['block', hero ? 'aspect-[16/10] w-full' : 'size-full']}></span>
	{:else if kind === 'video'}
		<video
			bind:this={video}
			{src}
			aria-label={hero ? label : undefined}
			muted
			loop
			playsinline
			preload="metadata"
			class={fit}
		></video>
	{:else}
		<img {src} alt={hero ? label : ''} class={fit} />
	{/if}
{/if}
