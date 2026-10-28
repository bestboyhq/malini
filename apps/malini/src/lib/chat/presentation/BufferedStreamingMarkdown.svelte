<script module lang="ts">
	type PlaybackSnapshot = {
		visibleText: string;
		revealedLength: number;
	};

	const PLAYBACK_CACHE_ENTRIES = 64;
	const playbackCache = new Map<string, PlaybackSnapshot>();

	function rememberPlayback(key: string, snapshot: PlaybackSnapshot): void {
		playbackCache.delete(key);
		playbackCache.set(key, snapshot);
		if (playbackCache.size <= PLAYBACK_CACHE_ENTRIES) return;
		const oldest = playbackCache.keys().next().value;
		if (oldest !== undefined) playbackCache.delete(oldest);
	}
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
		flush?: boolean;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
		onruncommand?: ((command: string) => void) | undefined;
	}

	let {
		text,
		class: className = '',
		playbackKey,
		complete = false,
		revealOnMount = false,
		flush = false,
		onopenfile,
		canopenfile,
		imagesrc,
		onopenimage,
		onruncommand,
	}: Props = $props();

	const FALLBACK_CHARACTER_WIDTH_PX = 7;
	const MIN_LINE_WIDTH_PX = 120;
	const TAIL_SETTLE_MS = 320;
	const MEASURED_WIDTHS = 4_096;
	const initialPlayback = untrack<PlaybackSnapshot>(() => {
		if (revealOnMount || flush) return { visibleText: text, revealedLength: text.length };
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
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let measuredWidth = 0;
	let measureText: TextWidthMeasurer = (value) => value.length * FALLBACK_CHARACTER_WIDTH_PX;

	function stopTimer(): void {
		if (revealTimer !== null) clearTimeout(revealTimer);
		if (settleTimer !== null) clearTimeout(settleTimer);
		revealTimer = null;
		settleTimer = null;
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
		rememberPlayback(playbackKey, { visibleText, revealedLength });
	}

	function revealDelay(): number {
		const lineWidth = Math.max(MIN_LINE_WIDTH_PX, availableWidth);
		return revealIntervalMs(latestSource, revealedLength, lineWidth / FALLBACK_CHARACTER_WIDTH_PX);
	}

	function settleTail(): void {
		settleTimer = setTimeout(() => {
			settleTimer = null;
			draining = false;
			animatedTailCharacters = 0;
		}, TAIL_SETTLE_MS);
	}

	function scheduleNextLine(): void {
		if (revealTimer !== null || settleTimer !== null) return;
		revealTimer = setTimeout(() => {
			revealTimer = null;
			revealNextLine();
		}, revealDelay());
	}

	function revealNextLine(): void {
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
	}

	function syncQueue(source: string, lineWidth: number): void {
		const sourceContracted = source.length < latestSource.length;
		latestSource = source;
		if (flush || (complete && !draining)) {
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
		void flush;
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
				const widths = new Map<string, number>();
				measureText = (value) => {
					const known = widths.get(value);
					if (known !== undefined) return known;
					if (widths.size >= MEASURED_WIDTHS) widths.clear();
					const width = context.measureText(value).width;
					widths.set(value, width);
					return width;
				};
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
			{onopenimage}
			{onruncommand}
		/>
	{/if}
</div>
