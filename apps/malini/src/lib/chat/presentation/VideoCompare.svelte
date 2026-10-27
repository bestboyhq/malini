<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Playhead } from '$hyper-ui/components/playhead';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { mediaMarker, mediaPath, type TurnComparison } from '$lib/chat/domain/turn-report';
	import MediaToolbarButton from './MediaToolbarButton.svelte';
	import { reportMediaSource } from './workstream-images';

	interface Props {
		comparison: TurnComparison;
		imagesrc?: ((path: string) => string | null) | undefined;
	}

	let { comparison, imagesrc }: Props = $props();

	const FPS = 60;
	const SPEEDS = [1, 0.5, 0.25] as const;

	const marker = $derived(mediaMarker(comparison.after.src));
	const beforeSrc = $derived(reportMediaSource(mediaPath(comparison.before.src), imagesrc));
	const afterSrc = $derived(reportMediaSource(mediaPath(comparison.after.src), imagesrc));

	let before = $state<HTMLVideoElement>();
	let after = $state<HTMLVideoElement>();
	let time = $state(0);
	let duration = $state(0);
	let playing = $state(false);
	let aspect = $state('16 / 9');
	let speed = $state<(typeof SPEEDS)[number]>(1);
	const frame = $derived(Math.round(time * FPS));
	const onMarker = $derived(marker !== null && Math.round(marker * FPS) === frame);

	$effect(() => {
		for (const video of [before, after]) if (video) video.playbackRate = speed;
	});

	function both(apply: (video: HTMLVideoElement) => void): void {
		for (const video of [before, after]) if (video) apply(video);
	}

	function pause(): void {
		both((video) => video.pause());
		playing = false;
	}

	function seek(to: number): void {
		time = Math.min(duration, Math.max(0, to));
		both((video) => {
			if (!video.seeking) video.currentTime = time;
		});
	}

	function onseeked(event: Event & { currentTarget: HTMLVideoElement }): void {
		const video = event.currentTarget;
		if (!playing && Math.abs(video.currentTime - time) > 1e-3) video.currentTime = time;
	}

	function follow(): void {
		if (!before || !after || !playing) return;
		requestAnimationFrame(follow);
		if (after.readyState === HTMLMediaElement.HAVE_NOTHING) return;
		time = after.currentTime;
		if (Math.abs(before.currentTime - after.currentTime) > 2 / FPS) before.currentTime = time;
	}

	function toggle(): void {
		if (playing) return pause();
		if (time >= duration - 1 / FPS) seek(0);
		both((video) => void video.play());
		playing = true;
		requestAnimationFrame(follow);
	}

	function step(frames: number): void {
		pause();
		seek((frame + frames) / FPS);
	}

	function cycleSpeed(): void {
		speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
	}

	function onloadedmetadata(event: Event & { currentTarget: HTMLVideoElement }): void {
		const video = event.currentTarget;
		duration = Math.max(duration, video.duration || 0);
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			aspect = `${video.videoWidth} / ${video.videoHeight}`;
		}
		if (marker !== null && time === 0) time = Math.min(marker, duration);
		video.currentTime = time;
		video.playbackRate = speed;
		if (playing) void video.play();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
		if (event.key === ' ') toggle();
		else if (event.key === ',') step(-1);
		else if (event.key === '.') step(1);
		else return;
		event.preventDefault();
	}
</script>

{#snippet player(src: string | null, state: 'Before' | 'After')}
	<div class="media bg-surface-root relative overflow-hidden rounded-md">
		{#if state === 'Before'}
			<video
				bind:this={before}
				{src}
				muted
				playsinline
				loop
				preload="auto"
				class="block w-full object-contain"
				style:aspect-ratio={aspect}
				{onloadedmetadata}
				{onseeked}
			></video>
		{:else}
			<video
				bind:this={after}
				{src}
				muted
				playsinline
				loop
				preload="auto"
				class="block w-full object-contain"
				style:aspect-ratio={aspect}
				{onloadedmetadata}
				{onseeked}
			></video>
		{/if}
		<span
			class={[
				'outline-border-subtle pointer-events-none absolute top-2 left-2 rounded-full px-1.5 text-[11px] leading-[18px] font-medium shadow-sm outline-[0.5px]',
				state === 'Before' ? 'bg-surface-invert text-fg-invert' : 'bg-brand text-brand-content',
			]}
		>
			{state}
		</span>
	</div>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="flex flex-col gap-1.5"
	role="group"
	aria-label="Before and after recordings"
	data-testid="report-video-compare"
	{onkeydown}
>
	<div class="grid grid-cols-2 gap-1.5">
		{@render player(beforeSrc, 'Before')}
		{@render player(afterSrc, 'After')}
	</div>
	<div class="flex items-center gap-0.5">
		<Tooltip content={playing ? 'Pause · Space' : 'Play both · Space'} placement="top">
			<IconButton
				variant="primary"
				size="sm"
				radius="md"
				ariaLabel={playing ? 'Pause' : 'Play both'}
				onclick={toggle}
			>
				<Icon name={playing ? 'pause' : 'play'} size={14} />
			</IconButton>
		</Tooltip>
		<span class="ml-1 flex items-center">
			<MediaToolbarButton
				tooltip="Previous frame · ,"
				label="Previous frame"
				square
				onclick={() => step(-1)}
			>
				<Icon name="chevron-left" size={14} />
			</MediaToolbarButton>
			<MediaToolbarButton
				tooltip="Next frame · ."
				label="Next frame"
				square
				onclick={() => step(1)}
			>
				<Icon name="chevron-right" size={14} />
			</MediaToolbarButton>
		</span>
		<span class="mx-2 flex min-w-0 flex-1">
			<Playhead
				value={time}
				max={duration}
				step={1 / FPS}
				{marker}
				label="Scrub both recordings"
				onseek={(to) => {
					pause();
					seek(to);
				}}
			/>
		</span>
		{#if marker !== null}
			<MediaToolbarButton
				tooltip={onMarker ? 'The moment the agent marked' : 'Jump to the moment the agent marked'}
				label="Jump to the marked moment"
				active={onMarker}
				onclick={() => step(Math.round(marker * FPS) - frame)}
			>
				<span class="bg-brand-foreground h-2.5 w-0.5 rounded-full"></span>
				<span class="font-mono tabular-nums">f{frame}</span>
			</MediaToolbarButton>
		{:else}
			<span class="text-fg-tertiary px-2 font-mono text-xs tabular-nums">f{frame}</span>
		{/if}
		<MediaToolbarButton
			tooltip="Playback speed"
			label="Playback speed {speed}×"
			onclick={cycleSpeed}
		>
			<span class="w-9 text-center tabular-nums">{speed}×</span>
		</MediaToolbarButton>
	</div>
</div>

<style>
	.media {
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}
</style>
