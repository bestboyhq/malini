import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptScroll, type TranscriptScroll } from './transcript-scroll.svelte';

const VIEWPORT_HEIGHT = 100;

type Transcript = Readonly<{
	scroll: TranscriptScroll;
	toolRow: HTMLElement;
	textRow: HTMLElement;
	replaceLastRow(height: number): void;
	reserveBelow(px: number): void;
	scrollUpBy(px: number): void;
	browserClampsUpBy(px: number): void;
	deliverScrollEvent(): void;
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

function transcriptOf(
	rowHeights: readonly number[],
	motion: { reduced: boolean } = { reduced: true },
): Transcript {
	const viewport = document.createElement('div');
	const list = document.createElement('div');
	const rows = rowHeights.map(rowOf);
	const [toolRow, textRow] = rows;
	if (!toolRow || !textRow) throw new Error('a transcript needs at least two rows');
	toolRow.dataset['messageKind'] = 'tool';
	list.append(...rows);
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
	const scroll = createTranscriptScroll({ prefersReducedMotion: () => motion.reduced });
	const stopObserving = scroll.observe(viewport, list);
	release = () => {
		stopObserving();
		scroll.destroy();
	};
	return {
		scroll,
		toolRow,
		textRow,
		replaceLastRow(height: number): void {
			list.lastElementChild?.replaceWith(rowOf(height));
		},
		reserveBelow(px: number): void {
			footer = px;
		},
		scrollUpBy(px: number): void {
			scroll.handleWheel(new WheelEvent('wheel', { deltaY: -px }));
			viewport.scrollTop -= px;
			scroll.handleScroll(viewport);
		},
		browserClampsUpBy(px: number): void {
			viewport.scrollTop -= px;
		},
		deliverScrollEvent(): void {
			scroll.handleScroll(viewport);
		},
		gapBelowLastRow: () => scrollTop + VIEWPORT_HEIGHT - rowsHeight() - footer,
		distanceFromBottom: () => scrollHeight() - VIEWPORT_HEIGHT - scrollTop,
	};
}

function mutationsDelivered(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function hoverOver(target: Element): void {
	target.dispatchEvent(new Event('pointermove', { bubbles: true }));
}

describe('a transcript while it opens', () => {
	it('opens on its last row', () => {
		const transcript = transcriptOf([200, 300]);

		transcript.scroll.open('opening-chat', null);

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.gapBelowLastRow()).toBe(0);
	});

	it('stays on its last row, reserving nothing below it, when its rows shrink as they mount', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat', null);

		transcript.replaceLastRow(220);
		await mutationsDelivered();

		expect(transcript.gapBelowLastRow()).toBe(0);
		expect(transcript.distanceFromBottom()).toBe(0);
	});

	it('stays on its last row, before the next frame, when its rows grow as they mount', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat', null);

		transcript.replaceLastRow(420);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
	});

	it('stays on its last row when the space below it is sized later in the update that opened it', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('opening-chat', null);

		transcript.reserveBelow(110);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.gapBelowLastRow()).toBe(0);
	});
});

describe('a transcript while its reply streams', () => {
	it('follows a reply that grows past the screen after a prompt is sent', async () => {
		const transcript = transcriptOf([200, 50]);
		transcript.scroll.open('streaming-chat', null);
		transcript.scroll.showNewPrompt(true);
		await nextFrame();

		transcript.replaceLastRow(900);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.scroll.contentBelow).toBe(false);
	});

	it('stops right where the reader scrolled up a little, and offers the new messages below', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('streaming-chat', null);
		transcript.scroll.followNewContent();

		transcript.scrollUpBy(10);
		transcript.replaceLastRow(600);
		await mutationsDelivered();

		expect(transcript.scroll.follow).toBe('reader');
		expect(transcript.distanceFromBottom()).toBe(310);
		expect(transcript.scroll.contentBelow).toBe(true);
	});

	it('stops when the reader scrolls up a little into the space held below a shrunken reply', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('streaming-chat', null);
		transcript.scroll.followNewContent();
		transcript.replaceLastRow(250);
		await mutationsDelivered();

		transcript.scrollUpBy(10);
		transcript.replaceLastRow(600);
		await mutationsDelivered();

		expect(transcript.scroll.follow).toBe('reader');
		expect(transcript.distanceFromBottom()).toBeGreaterThan(300);
	});

	it('keeps following when the browser clamps the glide up while a reply settles', async () => {
		const transcript = transcriptOf([200, 300], { reduced: false });
		transcript.scroll.open('streaming-chat', null);
		transcript.scroll.followNewContent();
		transcript.replaceLastRow(600);
		await mutationsDelivered();

		transcript.browserClampsUpBy(51);
		transcript.replaceLastRow(600);
		await mutationsDelivered();
		transcript.deliverScrollEvent();

		expect(transcript.scroll.follow).toBe('bottom');
		expect(transcript.scroll.contentBelow).toBe(false);
	});

	it('holds still while the pointer rests on a tool call, and catches up once it leaves', async () => {
		const transcript = transcriptOf([100, 100, 300]);
		transcript.scroll.open('streaming-chat', null);
		transcript.scroll.followNewContent();

		hoverOver(transcript.toolRow);
		transcript.replaceLastRow(600);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(300);
		expect(transcript.scroll.contentBelow).toBe(true);

		hoverOver(transcript.textRow);
		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.scroll.follow).toBe('bottom');
		expect(transcript.scroll.contentBelow).toBe(false);
	});

	it('jumps to the latest message and follows again when the reader asks for it', async () => {
		const transcript = transcriptOf([200, 300]);
		transcript.scroll.open('streaming-chat', null);
		transcript.scrollUpBy(150);

		transcript.scroll.jumpToLatest();
		transcript.replaceLastRow(600);
		await mutationsDelivered();

		expect(transcript.distanceFromBottom()).toBe(0);
		expect(transcript.scroll.follow).toBe('bottom');
		expect(transcript.scroll.contentBelow).toBe(false);
	});
});
