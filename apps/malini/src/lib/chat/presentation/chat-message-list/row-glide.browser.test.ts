import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowArrivals } from './row-arrival';

const FRAME_MS = 16;
let release: (() => void) | null = null;

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(performance.now()), FRAME_MS),
	);
	vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) =>
		clearTimeout(handle),
	);
});

afterEach(() => {
	release?.();
	release = null;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

function rowOf(height: number): HTMLElement {
	const row = document.createElement('div');
	row.dataset['height'] = String(height);
	Object.defineProperty(row, 'offsetTop', {
		get: () => {
			let top = 0;
			for (const sibling of row.parentElement?.children ?? []) {
				if (sibling === row) return top;
				top += Number(sibling instanceof HTMLElement ? sibling.dataset['height'] : 0);
			}
			return top;
		},
	});
	return row;
}

function glidingRun(...heights: number[]): { run: HTMLElement; rows: HTMLElement[] } {
	const run = document.createElement('li');
	const rows = heights.map(rowOf);
	run.append(...rows);
	document.body.append(run);
	const arrivals = createRowArrivals({
		settle: {
			isSettled: () => true,
			resettleTranscript: () => undefined,
			destroy: () => undefined,
		},
		prefersReducedMotion: () => false,
	});
	release = arrivals.glideRowLayout(run);
	return { run, rows };
}

function mutationsDelivered(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

function framesPass(count: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, count * FRAME_MS + 8));
}

describe('a live run whose rows change', () => {
	it('keeps the rows below a new row where they were on screen, then glides them to their place', async () => {
		const { run, rows } = glidingRun(40, 24);
		const status = rows[1] ?? null;

		run.insertBefore(rowOf(30), status);
		await mutationsDelivered();

		expect(status?.style.translate).toBe('0 -30px');
		await framesPass(60);
		expect(status?.style.translate).toBe('');
	});

	it('unrolls the new row instead of drawing it under the row still gliding away', async () => {
		const { run, rows } = glidingRun(40, 24);
		const arriving = rowOf(30);

		run.insertBefore(arriving, rows[1] ?? null);
		await mutationsDelivered();

		expect(arriving.style.clipPath).toBe('inset(-1rem -1rem 30px -1rem)');
		await framesPass(60);
		expect(arriving.style.clipPath).toBe('');
	});

	it('lets the rows below a removed row glide up into the space it leaves', async () => {
		const { rows } = glidingRun(40, 30, 24);

		rows[1]?.remove();
		await mutationsDelivered();

		expect(rows[2]?.style.translate).toBe('0 30px');
		expect(rows[0]?.style.clipPath).toBe('');
	});
});
