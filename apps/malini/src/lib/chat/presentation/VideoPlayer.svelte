<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Playhead } from '$hyper-ui/components/playhead';
	import { Icon } from '$hyper-ui/icons';
	import MediaToolbarButton from './MediaToolbarButton.svelte';
	import type { Playback, VideoHandoff } from './transcript-gallery';
	import VideoVolume from './VideoVolume.svelte';

	interface Props {
		src: string;
		label: string;
		autoplay: boolean;
		start?: Playback | undefined;
		autohide?: boolean;
		openLabel?: string;
		caption?: Snippet | undefined;
		onopen?: ((handoff: VideoHandoff) => void) | undefined;
		onclose?: (() => void) | undefined;
		onerror?: (() => void) | undefined;
	}

	let {
		src,
		label,
		autoplay,
		start,
		autohide = false,
		openLabel,
		caption,
		onopen,
		onclose,
		onerror,
	}: Props = $props();

	const FPS = 60;
	const SPEEDS: readonly number[] = [1, 0.5, 0.25];
	const REST_MS = 2000;

	let video = $state<HTMLVideoElement>();
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let muted = $state(untrack(() => start?.muted ?? true));
	let volume = $state(untrack(() => start?.volume ?? 1));
	let speed = $state(untrack(() => start?.speed ?? 1));
	let videoWidth = $state(0);
	let videoHeight = $state(0);
	let resting = $state(false);
	let restTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingSeek: number | null = null;
	let loadedSrc: string | undefined;
	let pending = $state<{ at: number; playing: boolean; speed: number } | null>(
		untrack(() => (start ? { at: start.at, playing: start.playing, speed: start.speed } : null)),
	);
	const stopped = $derived(pending ? !pending.playing : paused);
	const length = $derived(Number.isFinite(duration) ? duration : 0);
	const ratio = $derived(videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 10);

	$effect(() => {
		if (!video) return;
		if (autoplay) void video.play().catch(() => {});
		else video.pause();
	});

	$effect(() => () => clearTimeout(restTimer));

	$effect.pre(() => {
		if (video && loadedSrc !== undefined && src !== loadedSrc) {
			pending = { at: video.currentTime, playing: !video.paused, speed };
		}
		loadedSrc = src;
	});

	function resume(): void {
		if (!video || !pending) return;
		time = Math.min(pending.at, video.duration);
		speed = pending.speed;
		if (pending.playing) void video.play().catch(() => {});
		else video.pause();
		pending = null;
	}

	function playback(): Playback {
		return {
			at: pending?.at ?? time,
			playing: running(),
			muted,
			volume,
			speed: pending?.speed ?? speed,
		};
	}

	function adopt(next: Playback): void {
		muted = next.muted;
		volume = next.volume;
		pending = { at: next.at, playing: next.playing, speed: next.speed };
		if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) resume();
	}

	function open(): void {
		const handoff = { playback: playback(), resume: adopt };
		hold();
		onopen?.(handoff);
	}

	export function release(): Playback {
		const left = playback();
		hold();
		return left;
	}

	function wake(): void {
		resting = false;
		clearTimeout(restTimer);
		if (autohide && video && !video.paused) restTimer = setTimeout(() => (resting = true), REST_MS);
	}

	function running(): boolean {
		return pending ? pending.playing : video !== undefined && !video.paused;
	}

	export function toggle(): void {
		if (running()) hold();
		else play();
	}

	function hold(): void {
		if (pending) pending = { ...pending, playing: false };
		else video?.pause();
	}

	function play(): void {
		if (pending) pending = { ...pending, playing: true };
		else void video?.play().catch(() => {});
	}

	function step(frames: number): void {
		hold();
		time = Math.min(length, Math.max(0, time + frames / FPS));
	}

	function scrub(): void {
		if (!running()) return;
		hold();
		addEventListener('pointerup', play, { once: true });
	}

	function seek(to: number): void {
		if (pending) pending = { ...pending, at: to };
		if (video?.seeking) pendingSeek = to;
		else time = to;
	}

	function seeked(): void {
		if (pendingSeek !== null) time = pendingSeek;
		pendingSeek = null;
	}

	function cycleSpeed(): void {
		speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
	}

	function clock(seconds: number): string {
		const whole = Math.floor(seconds);
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
	}
</script>

<div class="[container-type:size] absolute inset-0 grid place-items-center">
	<div
		class="group/player @container/player pointer-events-auto relative rounded-md"
		style:width="min(100cqw, 100cqh * {ratio})"
		style:aspect-ratio={ratio}
		data-testid="video-player"
		role="group"
		onpointermove={wake}
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			bind:paused
			bind:currentTime={time}
			bind:duration
			bind:muted
			bind:volume
			bind:playbackRate={speed}
			bind:videoWidth
			bind:videoHeight
			{src}
			aria-label={label}
			loop
			playsinline
			preload="metadata"
			class="block size-full rounded-[inherit] object-contain"
			onplay={wake}
			onpause={wake}
			onseeked={seeked}
			onloadedmetadata={resume}
			{onerror}
		></video>
		<Button
			bare
			ariaLabel={onopen ? (openLabel ?? label) : stopped ? `Play ${label}` : `Pause ${label}`}
			tabindex={onopen ? 0 : -1}
			class={['absolute inset-0 rounded-[inherit]', onopen ? 'cursor-zoom-in' : 'cursor-default']}
			onclick={onopen ? open : toggle}
		/>
		{#if caption}
			<div
				class={[
					'pointer-events-none absolute inset-0 transition-transform duration-150 group-has-[:active]/player:-translate-y-11 group-has-[:focus-visible]/player:-translate-y-11 motion-reduce:transition-none',
					!resting && 'group-hover/player:-translate-y-11',
				]}
			>
				{@render caption()}
			</div>
		{/if}
		<div
			class={[
				'bg-surface-elevated/90 outline-surface-elevated-border absolute inset-x-2 bottom-2 mx-auto flex h-9 max-w-xl items-center gap-0.5 rounded-lg px-1 opacity-0 shadow-sm outline-[0.5px] -outline-offset-[0.5px] backdrop-blur-md transition-opacity duration-150 group-has-[:active]/player:opacity-100 group-has-[:focus-visible]/player:opacity-100 hover:opacity-100',
				!resting && 'group-hover/player:opacity-100',
			]}
			role="group"
			aria-label="Video controls"
		>
			<MediaToolbarButton
				tooltip={stopped ? 'Play' : 'Pause'}
				label={stopped ? 'Play' : 'Pause'}
				square
				onclick={toggle}
			>
				<Icon name={stopped ? 'play' : 'pause'} size={14} />
			</MediaToolbarButton>
			<span class="hidden items-center @lg/player:flex">
				<MediaToolbarButton
					tooltip="Previous frame"
					label="Previous frame"
					square
					onclick={() => step(-1)}
				>
					<Icon name="chevron-left" size={14} />
				</MediaToolbarButton>
				<MediaToolbarButton tooltip="Next frame" label="Next frame" square onclick={() => step(1)}>
					<Icon name="chevron-right" size={14} />
				</MediaToolbarButton>
			</span>
			<span class="mx-1.5 flex min-w-0 flex-1">
				<Playhead
					value={time}
					max={length}
					step={1 / FPS}
					marker={null}
					label="Scrub the recording"
					onseek={seek}
					ongrab={scrub}
				/>
			</span>
			<span class="text-fg-tertiary shrink-0 px-1 font-mono text-xs tabular-nums">
				{clock(time)} / {clock(length)}
			</span>
			<VideoVolume bind:muted bind:volume />
			<MediaToolbarButton
				tooltip="Playback speed"
				label="Playback speed {speed}×"
				onclick={cycleSpeed}
			>
				<span class="w-7 text-center tabular-nums">{speed}×</span>
			</MediaToolbarButton>
			{#if onopen}
				<MediaToolbarButton tooltip="Maximize" label="Maximize" square onclick={open}>
					<Icon name="maximize" size={14} />
				</MediaToolbarButton>
			{:else if onclose}
				<MediaToolbarButton tooltip="Minimize" label="Minimize" square onclick={onclose}>
					<Icon name="minimize" size={14} />
				</MediaToolbarButton>
			{/if}
		</div>
	</div>
</div>
