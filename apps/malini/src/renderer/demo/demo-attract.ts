const SWEEP_REST_MS = 2_200;
const WIPE: readonly (readonly [number, number])[] = [
	[0, 50],
	[420, 20],
	[1_150, 20],
	[1_700, 80],
	[2_450, 80],
	[2_900, 50],
];
export const WIPE_MS = 2_900;
const CYCLE_MS = 2_600;

type Stop = () => void;

export type DemoPlay = 'sweep' | 'cycle';

const PLAYS: readonly DemoPlay[] = ['sweep', 'cycle'];

export function playOf(value: string | null): DemoPlay | null {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	return PLAYS.find((play) => play === value) ?? null;
}

export const smooth = (t: number): number => t * t * t * (10 + t * (6 * t - 15));

export function wipeAt(ms: number): number {
	const next = WIPE.findIndex(([at]) => at > ms);
	const to = WIPE[next];
	const from = WIPE[next - 1];
	if (!to || !from) return 50;
	return from[1] + (to[1] - from[1]) * smooth((ms - from[0]) / (to[0] - from[0]));
}

export function whileWatched(view: HTMLElement, run: () => Stop, stopOnTouch: boolean): Stop {
	let halt: Stop | null = null;
	let touched = false;
	const end = (): void => {
		halt?.();
		halt = null;
	};
	const observer = new IntersectionObserver(
		([entry]) => {
			end();
			if (entry?.isIntersecting && !touched) halt = run();
		},
		{ threshold: 0.6 },
	);
	const touch = (): void => {
		touched = true;
		end();
	};
	observer.observe(view);
	if (stopOnTouch) view.addEventListener('pointerdown', touch, { once: true });
	return () => {
		observer.disconnect();
		view.removeEventListener('pointerdown', touch);
		end();
	};
}

export function sweepWipe(view: HTMLElement): Stop {
	const origin = performance.now();
	let frame = requestAnimationFrame(function sweep(now) {
		const wipe = view.querySelector('input[type="range"]');
		const t = (now - origin) % (WIPE_MS + SWEEP_REST_MS);
		if (wipe instanceof HTMLInputElement && t < WIPE_MS) {
			wipe.value = String(wipeAt(t));
			wipe.dispatchEvent(new Event('input', { bubbles: true }));
		}
		frame = requestAnimationFrame(sweep);
	});
	return () => cancelAnimationFrame(frame);
}

export function cycleTabs(view: HTMLElement): Stop {
	const timer = setInterval(() => {
		const tabs = [...view.querySelectorAll<HTMLElement>('[role="tab"]')];
		const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
		tabs[(current + 1) % tabs.length]?.click();
	}, CYCLE_MS);
	return () => clearInterval(timer);
}
