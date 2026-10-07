<script module lang="ts">
	type PlaybackSnapshot = {
		visibleText: string;
		revealedLength: number;
	};

	const playbackCache = new Map<string, PlaybackSnapshot>();
</script>

<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';
	import {
		nextCompleteVisualLineChunk,
		revealIntervalMs,
		type TextWidthMeasurer,
	} from './streaming-playback';

	interface Props {
		text: string;
		class?: string;
		playbackKey?: string | undefined;
		complete?: boolean;
		revealOnMount?: boolean;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
	}

	let {
		text,
		class: className = '',
		playbackKey,
		complete = false,
		revealOnMount = false,
		onopenfile,
		canopenfile,
		imagesrc,
	}: Props = $props();

	const FALLBACK_CHARACTER_WIDTH_PX = 7;
	const MIN_LINE_WIDTH_PX = 120;
	const TAIL_SETTLE_MS = 320;
	const initialPlayback = untrack<PlaybackSnapshot>(() => {
		if (revealOnMount) return { visibleText: text, revealedLength: text.length };
		const snapshot = playbackKey ? playbackCache.get(playbackKey) : undefined;
		const resumable = snapshot !== undefined && text.startsWith(snapshot.visibleText);
		if (complete && !resumable) return { visibleText: text, revealedLength: text.length };
		return {
			visibleText: snapshot?.visibleText ?? '',
			revealedLength: snapshot?.revealedLength ?? 0,
		};
	});

	let host: HTMLDivElement | null = $state(null);
	let availableWidth = $state(640);
	let visibleText = $state(initialPlayback.visibleText);
	let animatedTailCharacters = $state(0);
	let revealedLength = $state(initialPlayback.revealedLength);
	let latestSource = '';
	let draining = untrack(() => complete && initialPlayback.revealedLength < text.length);
	let revealTimer: ReturnType<typeof setTimeout> | null = null;
	let measuredWidth = 0;
	let measureText: TextWidthMeasurer = (value) => value.length * FALLBACK_CHARACTER_WIDTH_PX;

	function stopTimer(): void {
		if (revealTimer === null) return;
		clearTimeout(revealTimer);
		revealTimer = null;
	}

	function resetPlayback(): void {
		stopTimer();
		visibleText = '';
		animatedTailCharacters = 0;
		revealedLength = 0;
	}

	function persistPlayback(): void {
		if (!playbackKey) return;
		if (complete && revealedLength >= text.length) {
			playbackCache.delete(playbackKey);
			return;
		}
		playbackCache.set(playbackKey, { visibleText, revealedLength });
	}

	function revealDelay(): number {
		const lineWidth = Math.max(MIN_LINE_WIDTH_PX, availableWidth);
		return revealIntervalMs(latestSource, revealedLength, lineWidth / FALLBACK_CHARACTER_WIDTH_PX);
	}

	function settleTail(): void {
		revealTimer = setTimeout(() => {
			revealTimer = null;
			draining = false;
			animatedTailCharacters = 0;
		}, TAIL_SETTLE_MS);
	}

	function scheduleNextLine(): void {
		if (revealTimer !== null) return;
		revealTimer = setTimeout(() => {
			revealTimer = null;
			if (!latestSource.startsWith(visibleText)) {
				visibleText = '';
				revealedLength = 0;
				animatedTailCharacters = 0;
			}
			const nextLine =
				nextCompleteVisualLineChunk(
					latestSource,
					revealedLength,
					Math.max(MIN_LINE_WIDTH_PX, availableWidth),
					measureText,
				) ?? (complete ? latestSource.slice(revealedLength) || null : null);
			if (!nextLine) return;
			visibleText += nextLine;
			revealedLength += nextLine.length;
			animatedTailCharacters = nextLine.length;
			persistPlayback();
			if (revealedLength < latestSource.length) scheduleNextLine();
			else if (complete) settleTail();
		}, revealDelay());
	}

	function syncQueue(source: string, lineWidth: number): void {
		const sourceContracted = source.length < latestSource.length;
		latestSource = source;
		if (complete && !draining) {
			stopTimer();
			visibleText = source;
			revealedLength = source.length;
			animatedTailCharacters = 0;
			persistPlayback();
			return;
		}
		if (sourceContracted || source.length < revealedLength) resetPlayback();
		void lineWidth;
		scheduleNextLine();
	}

	$effect(() => {
		const source = text;
		const width = availableWidth;
		untrack(() => syncQueue(source, width));
	});

	onMount(() => {
		if (complete && !draining) return;
		const element = host;
		if (!element) return;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		let measurementFrame: number | null = null;
		const updateMeasurements = (): void => {
			const style = getComputedStyle(element);
			if (context) {
				context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
				measureText = (value) => context.measureText(value).width;
			}
			const nextWidth = Math.max(MIN_LINE_WIDTH_PX, element.clientWidth);
			if (Math.abs(nextWidth - measuredWidth) < 0.5) return;
			measuredWidth = nextWidth;
			availableWidth = nextWidth;
			syncQueue(latestSource, nextWidth);
		};
		const scheduleMeasurements = (): void => {
			if (measurementFrame !== null) return;
			measurementFrame = requestAnimationFrame(() => {
				measurementFrame = null;
				updateMeasurements();
			});
		};

		updateMeasurements();
		const observer = new ResizeObserver(scheduleMeasurements);
		observer.observe(element);
		return () => {
			observer.disconnect();
			if (measurementFrame !== null) cancelAnimationFrame(measurementFrame);
			stopTimer();
		};
	});

	onDestroy(() => {
		persistPlayback();
		stopTimer();
	});
</script>

<div
	bind:this={host}
	class={className}
	data-testid="buffered-streaming-markdown"
	data-buffered-characters={Math.max(0, text.length - revealedLength)}
	aria-live="polite"
>
	{#if visibleText}
		<MarkdownText
			text={visibleText}
			class="select-text"
			mode="prose"
			streamingTailCharacters={animatedTailCharacters}
			{onopenfile}
			{canopenfile}
			{imagesrc}
		/>
	{/if}
</div>
