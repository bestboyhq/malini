import type { BrowserBounds } from '$contract/browser';

export type BrowserPlacement =
	| Readonly<{ kind: 'shown'; bounds: BrowserBounds }>
	| Readonly<{ kind: 'covered' }>
	| Readonly<{ kind: 'hidden' }>;

export type BrowserViewport = Readonly<{
	left: number;
	top: number;
	right: number;
	bottom: number;
}>;

export const HIDDEN_BROWSER: BrowserPlacement = { kind: 'hidden' };

export function browserPlacementFor(
	viewport: BrowserViewport,
	hasPage: boolean,
	covered: boolean,
): BrowserPlacement {
	const x = Math.round(viewport.left);
	const y = Math.round(viewport.top);
	const width = placedWidth(viewport);
	const height = Math.round(viewport.bottom) - y;
	if (!hasPage || width <= 0 || height <= 0) return HIDDEN_BROWSER;
	if (covered) return { kind: 'covered' };
	return { kind: 'shown', bounds: { x, y, width, height } };
}

export function placedWidth(viewport: BrowserViewport): number {
	return Math.round(viewport.right) - Math.round(viewport.left);
}

export function sameBrowserPlacement(left: BrowserPlacement, right: BrowserPlacement): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind !== 'shown' || right.kind !== 'shown') return true;
	const { x, y, width, height } = left.bounds;
	const next = right.bounds;
	return x === next.x && y === next.y && width === next.width && height === next.height;
}
