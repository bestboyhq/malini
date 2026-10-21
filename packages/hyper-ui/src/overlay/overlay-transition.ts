import type { TransitionConfig } from 'svelte/transition';
import type { MenuAlign, MenuSide } from './positioning';

export interface MenuTransitionParams {
	side: MenuSide;
	align: MenuAlign;
	skip?: boolean;
}

const ENTER_MS = 200;
const EXIT_MS = 140;
const REDUCED_MOTION_MS = 70;
const START_SCALE = 0.935;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const along = (a: number, b: number, s: number): number =>
		3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
	return (t) => {
		let low = 0;
		let high = 1;
		for (let step = 0; step < 24; step += 1) {
			const mid = (low + high) / 2;
			if (along(x1, x2, mid) < t) low = mid;
			else high = mid;
		}
		return along(y1, y2, (low + high) / 2);
	};
}

function transformOriginFor(side: MenuSide, align: MenuAlign): string {
	if (side === 'top' || side === 'bottom') {
		const vertical = side === 'top' ? 'bottom' : 'top';
		const horizontal = align === 'end' ? 'right' : align === 'center' ? 'center' : 'left';
		return `${vertical} ${horizontal}`;
	}
	const horizontal = side === 'left' ? 'right' : 'left';
	const vertical = align === 'end' ? 'bottom' : align === 'center' ? 'center' : 'top';
	return `${vertical} ${horizontal}`;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		Boolean(window.matchMedia) &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

function menuMotion(
	node: HTMLElement,
	params: MenuTransitionParams,
	duration: number,
): TransitionConfig {
	if (params.skip) return { duration: 0, css: () => '' };
	const reduced = prefersReducedMotion();
	node.style.transformOrigin = transformOriginFor(params.side, params.align);
	node.style.willChange = 'transform, opacity';
	return {
		duration: reduced ? REDUCED_MOTION_MS : duration,
		easing: EASE_OUT,
		css: (t) =>
			reduced
				? `opacity: ${t};`
				: `opacity: ${t}; transform: scale(${START_SCALE + (1 - START_SCALE) * t});`,
	};
}

export function menuOpen(node: HTMLElement, params: MenuTransitionParams): TransitionConfig {
	node.style.removeProperty('pointer-events');
	return menuMotion(node, params, ENTER_MS);
}

export function menuClose(node: HTMLElement, params: MenuTransitionParams): TransitionConfig {
	node.style.pointerEvents = 'none';
	return menuMotion(node, params, EXIT_MS);
}
