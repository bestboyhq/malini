import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowArrivals } from './row-arrival';

let release: (() => void) | null = null;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
	release?.();
	release = null;
	document.body.replaceChildren();
	vi.useRealTimers();
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

function glidingRun(
	heights: readonly number[],
	{ opening = false } = {},
): { run: HTMLElement; rows: HTMLElement[] } {
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
		opening: () => opening,
		prefersReducedMotion: () => false,
	});
	release = arrivals.glideRowLayout(run);
	return { run, rows };
}

function mutationsDelivered(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

function framesPass(count: number): void {
	for (let frame = 0; frame < count; frame += 1) vi.advanceTimersToNextFrame();
}

describe('a live run whose rows change', () => {
	it('keeps the rows below a new row where they were on screen, then glides them to their place', async () => {
		const { run, rows } = glidingRun([40, 24]);
		const status = rows[1] ?? null;

		run.insertBefore(rowOf(30), status);
		await mutationsDelivered();

		expect(status?.style.translate).toBe('0 -30px');
		framesPass(60);
		expect(status?.style.translate).toBe('');
	});

	it('lets the new row emerge above the row still gliding away instead of drawing under it', async () => {
		const { run, rows } = glidingRun([40, 24]);
		const arriving = rowOf(30);

		run.insertBefore(arriving, rows[1] ?? null);
		await mutationsDelivered();

		expect(arriving.style.maskImage).toContain('transparent 30px');
		framesPass(60);
		expect(arriving.style.maskImage).toBe('');
	});

	it('lets the rows below a removed row glide up into the space it leaves', async () => {
		const { rows } = glidingRun([40, 30, 24]);

		rows[1]?.remove();
		await mutationsDelivered();

		expect(rows[2]?.style.translate).toBe('0 30px');
		expect(rows[0]?.style.maskImage).toBe('');
	});
});

describe('a chat that is still opening', () => {
	it('leaves the rows below a message where they land when its late content loads', async () => {
		const { rows } = glidingRun([40, 24], { opening: true });
		const [message, footer] = rows;

		message?.append(document.createElement('img'));
		if (message) message.dataset['height'] = '340';
		await mutationsDelivered();

		expect(footer?.style.translate).toBe('');
		expect(message?.style.maskImage).toBe('');
	});
});
