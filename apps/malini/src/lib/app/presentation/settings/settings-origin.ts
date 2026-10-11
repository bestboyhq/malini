import { getContext, setContext } from 'svelte';

export type ViewSnapshot = Readonly<{
	width: number;
	height: number;
	mount: (host: HTMLElement) => () => void;
}>;

const SETTINGS_ORIGIN = Symbol('settings-origin');
const SETTINGS_PATH = /^\/settings(?:\/|$)/u;
const PRIVATE_ATTRIBUTES = ['id', 'data-testid', 'data-native-drag-region', 'autofocus'];
const TRANSIENT_STYLES = 'style[data-malini-panel-styles]';
const STYLESHEET = 'link[rel="stylesheet"]';
const ISOLATING_LAYOUTS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);

export class SettingsOrigin {
	href = '/';
	view: ViewSnapshot | null = null;

	follow(from: URL | undefined, to: URL | undefined, shell: HTMLElement | undefined): void {
		const leaving = isSettingsPath(from);
		const entering = isSettingsPath(to);
		if (entering && !leaving && from) {
			this.href = `${from.pathname}${from.search}${from.hash}`;
			this.view = shell ? snapshotView(shell) : null;
		}
		if (leaving && !entering) this.view = null;
	}
}

export function provideSettingsOrigin(): SettingsOrigin {
	return setContext(SETTINGS_ORIGIN, new SettingsOrigin());
}

export function settingsOrigin(): SettingsOrigin {
	return getContext<SettingsOrigin | undefined>(SETTINGS_ORIGIN) ?? new SettingsOrigin();
}

function isSettingsPath(url: URL | undefined): boolean {
	return url !== undefined && SETTINGS_PATH.test(url.pathname);
}

function snapshotView(shell: HTMLElement): ViewSnapshot | null {
	const copy = shell.cloneNode(true);
	if (!(copy instanceof HTMLElement)) return null;
	const originals = [shell, ...shell.querySelectorAll('*')];
	const copies = [copy, ...copy.querySelectorAll('*')];
	const scrolled: (readonly [Element, number, number])[] = [];
	originals.forEach((original, index) => {
		const twin = copies[index];
		if (!twin) return;
		if (original.scrollTop || original.scrollLeft) {
			scrolled.push([twin, original.scrollTop, original.scrollLeft]);
		}
		if (original instanceof HTMLCanvasElement && twin instanceof HTMLCanvasElement) {
			copyCanvas(original, twin);
		}
	});
	pruneOffscreen(shell, copy);
	for (const element of [copy, ...copy.querySelectorAll('*')]) {
		for (const attribute of PRIVATE_ATTRIBUTES) element.removeAttribute(attribute);
	}
	carryRootVariables(copy);
	const styles = transientStyles();
	return {
		width: window.innerWidth,
		height: window.innerHeight,
		mount: (host) => {
			const firstSheet = document.head.querySelector(STYLESHEET);
			for (const [style, beforeSheets] of styles) {
				if (beforeSheets && firstSheet) firstSheet.before(style);
				else document.head.append(style);
			}
			host.append(copy);
			for (const [element, top, left] of scrolled) element.scrollTo({ top, left });
			return () => {
				copy.remove();
				for (const [style] of styles) style.remove();
			};
		},
	};
}

function pruneOffscreen(original: Element, twin: Element): void {
	const twins = Array.from(twin.children);
	const itemsAreIsolated = ISOLATING_LAYOUTS.has(getComputedStyle(original).display);
	Array.from(original.children).forEach((child, index) => {
		const childTwin = twins[index];
		if (!childTwin) return;
		const box = child.getBoundingClientRect();
		if (!itemsAreIsolated || !(childTwin instanceof HTMLElement) || !isOffscreen(box)) {
			pruneOffscreen(child, childTwin);
			return;
		}
		childTwin.replaceChildren();
		childTwin.style.width = `${box.width}px`;
		childTwin.style.height = `${box.height}px`;
		childTwin.style.flexShrink = '0';
	});
}

function isOffscreen(box: DOMRect): boolean {
	if (box.width === 0 && box.height === 0) return false;
	return box.bottom < 0 || box.top > window.innerHeight;
}

function carryRootVariables(copy: HTMLElement): void {
	const root = document.documentElement.style;
	for (const name of Array.from(root)) {
		if (name.startsWith('--')) copy.style.setProperty(name, root.getPropertyValue(name));
	}
}

function transientStyles(): (readonly [HTMLStyleElement, boolean])[] {
	const firstSheet = document.head.querySelector(STYLESHEET);
	return Array.from(document.head.querySelectorAll(TRANSIENT_STYLES)).flatMap((style) => {
		const twin = style.cloneNode(true);
		if (!(twin instanceof HTMLStyleElement)) return [];
		const beforeSheets =
			firstSheet !== null &&
			Boolean(style.compareDocumentPosition(firstSheet) & Node.DOCUMENT_POSITION_FOLLOWING);
		twin.removeAttribute('data-malini-panel-styles');
		return [[twin, beforeSheets] as const];
	});
}

function copyCanvas(original: HTMLCanvasElement, twin: HTMLCanvasElement): void {
	try {
		twin.getContext('2d')?.drawImage(original, 0, 0);
	} catch {
		return;
	}
}
