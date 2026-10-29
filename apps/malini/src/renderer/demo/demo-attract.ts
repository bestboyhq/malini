const SWEEP_MS = 4_800;
const SWEEP_REST_MS = 1_600;
const CYCLE_MS = 2_600;

type Stop = () => void;

export type DemoPlay = 'work' | 'sweep' | 'cycle';

const PLAYS: readonly DemoPlay[] = ['work', 'sweep', 'cycle'];

export function playOf(value: string | null): DemoPlay | null {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	return PLAYS.find((play) => play === value) ?? null;
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
		const t = (now - origin) % (SWEEP_MS + SWEEP_REST_MS);
		if (wipe instanceof HTMLInputElement && t < SWEEP_MS) {
			wipe.value = String(50 + 38 * Math.sin((2 * Math.PI * t) / SWEEP_MS));
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
