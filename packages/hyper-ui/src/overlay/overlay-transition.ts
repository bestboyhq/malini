import { cubicIn, cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import type { MenuAlign, MenuSide } from './positioning';

export interface MenuTransitionParams {
	side: MenuSide;
	align: MenuAlign;
	duration?: number;
	skip?: boolean;
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

function offsetFor(side: MenuSide): { dx: number; dy: number } {
	if (side === 'top') return { dx: 0, dy: 4 };
	if (side === 'bottom') return { dx: 0, dy: -4 };
	if (side === 'left') return { dx: 4, dy: 0 };
	return { dx: -4, dy: 0 };
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		Boolean(window.matchMedia) &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

export function menuOpen(node: HTMLElement, params: MenuTransitionParams): TransitionConfig {
	const reduced = prefersReducedMotion();
	const duration = reduced ? 70 : (params.duration ?? 120);
	const { dx, dy } = offsetFor(params.side);
	node.style.transformOrigin = transformOriginFor(params.side, params.align);
	node.style.willChange = 'transform, opacity';

	return {
		duration,
		easing: cubicOut,
		css: (t, u) => {
			if (reduced) return `opacity: ${t};`;
			return `opacity: ${t}; transform: translate(${dx * u}px, ${dy * u}px) scale(${0.95 + 0.05 * t});`;
		},
	};
}

export function menuClose(node: HTMLElement, params: MenuTransitionParams): TransitionConfig {
	if (params.skip) return { duration: 0, css: () => '' };
	const reduced = prefersReducedMotion();
	const duration = reduced ? 50 : (params.duration ?? 80);
	node.style.transformOrigin = transformOriginFor(params.side, params.align);
	node.style.willChange = 'transform, opacity';

	return {
		duration,
		easing: cubicIn,
		css: (t) => {
			if (reduced) return `opacity: ${t};`;
			return `opacity: ${t}; transform: scale(${0.97 + 0.03 * t});`;
		},
	};
}
