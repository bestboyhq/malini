import { getContext, setContext } from 'svelte';

const TREE_KEY = Symbol('hyper-menu-tree');
const SURFACE_KEY = Symbol('hyper-menu-surface');

export interface Point {
	x: number;
	y: number;
}

export interface SafeArea {
	points: [Point, Point, Point];
	expiresAt: number;
}

export interface MenuTree {
	closeAll(immediate?: boolean): void;
}

export interface MenuSurface {
	readonly openChildId: string | null;
	openChild(id: string): void;
	closeChild(id: string): void;
	closeAllChildren(): void;
	setSafeArea(area: SafeArea | null): void;
	isInSafeArea(x: number, y: number): boolean;
}

export function createMenuTree(close: (immediate?: boolean) => void): MenuTree {
	return { closeAll: close };
}

export function createMenuSurface(): MenuSurface {
	let openChildId: string | null = $state(null);
	let safeArea: SafeArea | null = $state(null);
	return {
		get openChildId(): string | null {
			return openChildId;
		},
		openChild(id: string): void {
			openChildId = id;
		},
		closeChild(id: string): void {
			if (openChildId === id) {
				openChildId = null;
				safeArea = null;
			}
		},
		closeAllChildren(): void {
			openChildId = null;
			safeArea = null;
		},
		setSafeArea(area: SafeArea | null): void {
			safeArea = area;
		},
		isInSafeArea(x: number, y: number): boolean {
			if (!safeArea) return false;
			if (performance.now() > safeArea.expiresAt) {
				safeArea = null;
				return false;
			}
			const [a, b, c] = safeArea.points;
			const sign = (p1: Point, p2: Point, p3: Point): number =>
				(p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
			const point = { x, y };
			const d1 = sign(point, a, b);
			const d2 = sign(point, b, c);
			const d3 = sign(point, c, a);
			return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
		},
	};
}

export function setMenuTreeContext(tree: MenuTree): void {
	setContext(TREE_KEY, tree);
}

export function getMenuTreeContext(): MenuTree | undefined {
	return getContext<MenuTree | undefined>(TREE_KEY);
}

export function setMenuSurfaceContext(surface: MenuSurface): void {
	setContext(SURFACE_KEY, surface);
}

export function getMenuSurfaceContext(): MenuSurface | undefined {
	return getContext<MenuSurface | undefined>(SURFACE_KEY);
}
