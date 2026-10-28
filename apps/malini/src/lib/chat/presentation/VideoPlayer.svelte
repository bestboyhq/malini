<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Playhead } from '$hyper-ui/components/playhead';
	import { Icon } from '$hyper-ui/icons';
	import MediaToolbarButton from './MediaToolbarButton.svelte';
	import VideoVolume from './VideoVolume.svelte';

	interface Props {
		src: string;
		label: string;
		autoplay: boolean;
		autohide?: boolean;
		openLabel?: string;
		onopen?: (() => void) | undefined;
		onerror?: (() => void) | undefined;
	}

	let { src, label, autoplay, autohide = false, openLabel, onopen, onerror }: Props = $props();

	const FPS = 60;
	const SPEEDS = [1, 0.5, 0.25] as const;
	const REST_MS = 2000;

	let video = $state<HTMLVideoElement>();
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let muted = $state(true);
	let volume = $state(1);
	let speed = $state<(typeof SPEEDS)[number]>(1);
	let videoWidth = $state(0);
	let videoHeight = $state(0);
	let resting = $state(false);
	let restTimer: ReturnType<typeof setTimeout> | undefined;
	const length = $derived(Number.isFinite(duration) ? duration : 0);
	const ratio = $derived(videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 10);

	$effect(() => {
		if (!video) return;
		if (autoplay) void video.play().catch(() => {});
		else video.pause();
	});

	$effect(() => () => clearTimeout(restTimer));

	function wake(): void {
		resting = false;
		clearTimeout(restTimer);
		if (autohide && video && !video.paused) restTimer = setTimeout(() => (resting = true), REST_MS);
	}

	export function toggle(): void {
		if (!video) return;
		if (video.paused) void video.play().catch(() => {});
		else video.pause();
	}

	function step(frames: number): void {
		video?.pause();
		time = Math.min(length, Math.max(0, time + frames / FPS));
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
			{autoplay}
			aria-label={label}
			loop
			playsinline
			preload="metadata"
			class="block size-full rounded-[inherit] object-contain"
			onplay={wake}
			onpause={wake}
			{onerror}
		></video>
		<Button
			bare
			ariaLabel={onopen ? (openLabel ?? label) : paused ? `Play ${label}` : `Pause ${label}`}
			tabindex={onopen ? 0 : -1}
			class={['absolute inset-0 rounded-[inherit]', onopen ? 'cursor-zoom-in' : 'cursor-default']}
			onclick={onopen ?? toggle}
		/>
		<div
			class={[
				'bg-surface-elevated/90 outline-surface-elevated-border absolute inset-x-2 bottom-2 mx-auto flex h-9 max-w-xl items-center gap-0.5 rounded-lg px-1 opacity-0 shadow-sm outline-[0.5px] -outline-offset-[0.5px] backdrop-blur-md transition-opacity duration-150 group-has-[:active]/player:opacity-100 group-has-[:focus-visible]/player:opacity-100 hover:opacity-100',
				!resting && 'group-hover/player:opacity-100',
			]}
			role="group"
			aria-label="Video controls"
		>
			<MediaToolbarButton
				tooltip={paused ? 'Play' : 'Pause'}
				label={paused ? 'Play' : 'Pause'}
				square
				onclick={toggle}
			>
				<Icon name={paused ? 'play' : 'pause'} size={14} />
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
					onseek={(to) => (time = to)}
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
		</div>
	</div>
</div>
