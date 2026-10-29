import { smooth } from './demo-attract';

export class Stopped extends Error {}

export type Point = Readonly<{ x: number; y: number }>;

export function inView(): Promise<void> {
	return new Promise((resolve) => {
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				resolve();
			},
			{ threshold: 0.6 },
		);
		observer.observe(document.documentElement);
	});
}

export type Cursor = Readonly<{
	element: HTMLElement;
	at: () => Point;
	place: (point: Point) => void;
	wait: (ms: number) => Promise<void>;
	frame: () => Promise<number>;
	find: (selector: string, scope?: () => ParentNode | null) => Promise<HTMLElement>;
	glide: (to: Point) => Promise<void>;
	moveTo: (element: HTMLElement, dx?: number) => Promise<void>;
	press: () => Promise<void>;
	click: (element: HTMLElement, dx?: number) => Promise<void>;
}>;

export function drawnCursor(start: Point): Cursor | null {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	const element = document.querySelector<HTMLElement>('.demo-cursor');
	if (!element) return null;
	element.hidden = false;
	let stopped = false;
	let at = start;
	const place = (point: Point): void => {
		at = point;
		element.style.translate = `${point.x}px ${point.y}px`;
	};
	place(at);
	const stop = (event: Event): void => {
		if (!event.isTrusted) return;
		stopped = true;
		element.hidden = true;
	};
	addEventListener('pointerdown', stop, { capture: true });
	addEventListener('keydown', stop, { capture: true });

	const wait = async (ms: number): Promise<void> => {
		await new Promise((resolve) => setTimeout(resolve, ms));
		if (stopped) throw new Stopped();
	};
	const frame = async (): Promise<number> => {
		const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
		if (stopped) throw new Stopped();
		return now;
	};
	const find = async (
		selector: string,
		scope: () => ParentNode | null = () => document,
	): Promise<HTMLElement> => {
		for (;;) {
			const found = scope()?.querySelector(selector);
			if (found instanceof HTMLElement && found.getClientRects().length > 0) return found;
			await wait(100);
		}
	};
	const glide = async (to: Point): Promise<void> => {
		const from = at;
		const distance = Math.hypot(to.x - from.x, to.y - from.y);
		const duration = Math.min(1_250, 420 + distance * 0.75);
		const bend = Math.min(60, distance * 0.12) / (distance || 1);
		const control = {
			x: (from.x + to.x) / 2 - (to.y - from.y) * bend,
			y: (from.y + to.y) / 2 + (to.x - from.x) * bend,
		};
		const started = await frame();
		for (let now = started; now - started < duration; now = await frame()) {
			const t = smooth((now - started) / duration);
			const u = 1 - t;
			place({
				x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
				y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
			});
		}
		place(to);
	};
	const moveTo = async (target: HTMLElement, dx = 0.5): Promise<void> => {
		const box = target.getBoundingClientRect();
		await glide({ x: box.left + box.width * dx, y: box.top + box.height / 2 });
		await wait(120 + Math.random() * 120);
	};
	const press = async (): Promise<void> => {
		element.dataset['pressed'] = '';
		await wait(130);
		delete element.dataset['pressed'];
	};
	const click = async (target: HTMLElement, dx = 0.5): Promise<void> => {
		await moveTo(target, dx);
		await press();
		target.click();
	};
	return { element, at: () => at, place, wait, frame, find, glide, moveTo, press, click };
}
