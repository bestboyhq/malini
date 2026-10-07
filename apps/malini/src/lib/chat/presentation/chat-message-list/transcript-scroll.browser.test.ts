import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptScroll, type TranscriptScroll } from './transcript-scroll.svelte';

const VIEWPORT_HEIGHT = 100;

type Transcript = Readonly<{
	scroll: TranscriptScroll;
	replaceLastRow(height: number): void;
	reserveBelow(px: number): void;
	gapBelowLastRow(): number;
	distanceFromBottom(): number;
}>;

let release: (() => void) | null = null;

afterEach(() => {
	release?.();
	release = null;
	document.body.replaceChildren();
});

function rowOf(height: number): HTMLElement {
	const row = document.createElement('div');
	row.dataset['height'] = String(height);
	return row;
}

function transcriptOf(rowHeights: readonly number[]): Transcript {
	const viewport = document.createElement('div');
	const list = document.createElement('div');
	list.append(...rowHeights.map(rowOf));
	viewport.append(list);
	document.body.append(viewport);
	const rowsHeight = (): number =>
		[...list.children].reduce(
			(sum, row) => sum + Number(row instanceof HTMLElement ? row.dataset['height'] : 0),
			0,
		);
	let footer = 0;
	const reservedBelow = (): number =>
		footer + (Number.parseFloat(list.style.getPropertyValue('--chat-hold-space')) || 0);
	const scrollHeight = (): number => Math.max(VIEWPORT_HEIGHT, rowsHeight() + reservedBelow());
	let scrollTop = 0;
	Object.defineProperty(viewport, 'clientHeight', { get: () => VIEWPORT_HEIGHT });
	Object.defineProperty(viewport, 'scrollHeight', { get: scrollHeight });
	Object.defineProperty(viewport, 'scrollTop', {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = Math.max(0, Math.min(value, scrollHeight() - VIEWPORT_HEIGHT));
		},
	});
	const scroll = createTranscriptScroll();
	const stopObserving = scroll.observe(viewport, list);
	release = () => {
		stopObserving();
		scroll.destroy();
	};
	return {
		scroll,
		replaceLastRow(height: number): void {
			list.lastElementChild?.replaceWith(rowOf(height));
		},
		reserveBelow(px: number): void {
			footer = px;
		},
		gapBelowLastRow: () => scrollTop + VIEWPORT_HEIGHT - rowsHeight() - footer,
		distanceFromBottom: () => scrollHeight() - VIEWPORT_HEIGHT - scrollTop,
	};
}

function mutationsDelivered(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

describe('a transcript while it opens', () => {
	it('opens on its last row', () => {
		const transcript = transcriptOf([200, 300]);

		transcript.scroll.open('opening-chat');

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.gapBelowLastRow()).toBe(0);
	});

	it('stays on its last row, reserving nothing below it, when its rows shrink as they mount', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat');

		transcript.replaceLastRow(220);
		await mutationsDelivered();

		expect(transcript.gapBelowLastRow()).toBe(0);
		expect(transcript.distanceFromBottom()).toBe(0);
	});

	it('stays on its last row, before the next frame, when its rows grow as they mount', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat');

		transcript.replaceLastRow(420);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
	});

	it('stays on its last row when the space below it is sized later in the update that opened it', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat');

		transcript.reserveBelow(110);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.gapBelowLastRow()).toBe(0);
	});
});
