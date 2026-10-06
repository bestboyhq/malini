import type { Component } from 'svelte';
import {
	HISTORY_INDEX_KEY,
	NAVIGATION_INDEX_KEY,
	navigationHistoryTargetLedger,
} from '$shared/router/history-ledger';
import { invoke } from '$shared/port/invoke';
import { scheduleAfterNavigationPaint } from '$shared/performance/navigation-paint-scheduler';

export type RouteParams = Record<string, string>;

export type PageState = App.PageState;

export type RouteComponent = Component<never>;

export type ComponentLoader = () => Promise<{ default: RouteComponent }>;

export type RouteNode = Readonly<{
	segment: string;
	layout?: ComponentLoader;
	page?: ComponentLoader;
	redirect?: string;
	children?: readonly RouteNode[];
}>;

export type RouteMatch = Readonly<{
	id: string;
	params: RouteParams;
	loaders: readonly ComponentLoader[];
	redirect: string | null;
}>;

export type NavigationTarget = Readonly<{
	url: URL;
	params: RouteParams;
	route: Readonly<{ id: string | null }>;
}>;

export type NavigationType = 'enter' | 'link' | 'goto' | 'popstate';

export type Navigation = Readonly<{
	from: NavigationTarget | null;
	to: NavigationTarget | null;
	type: NavigationType;
	willUnload: false;
	delta?: number;
	complete: Promise<void>;
}>;

export type BeforeNavigate = Navigation & Readonly<{ cancel(): void }>;

export type AfterNavigate = Navigation;

export type Page = Readonly<{
	url: URL;
	params: RouteParams;
	route: Readonly<{ id: string | null }>;
	state: PageState;
	status: number;
	error: null;
	data: Record<string, never>;
	form: null;
}>;

export type RouterView = Readonly<{
	match: RouteMatch | null;
	components: readonly RouteComponent[];
}>;

export type GotoOptions = Readonly<{
	replaceState?: boolean;
	noScroll?: boolean;
	keepFocus?: boolean;
	invalidateAll?: boolean;
	invalidate?: readonly unknown[];
	state?: PageState;
}>;

export type RouterStartOptions = Readonly<{
	routes: RouteNode;
	notFound: ComponentLoader;
	openExternalUrl?: (url: string) => void;
	target?: Window;
}>;

export const ROUTER_ORIGIN = 'http://malini.local';

const PAGE_STATE_KEY = 'malini:state';

export function matchRoute(root: RouteNode, pathname: string): RouteMatch | null {
	const segments = pathname.split('/').filter(Boolean);
	return matchNode(root, segments, 0, {}, [], []);
}

function matchNode(
	node: RouteNode,
	segments: readonly string[],
	index: number,
	params: RouteParams,
	layouts: readonly ComponentLoader[],
	idParts: readonly string[],
): RouteMatch | null {
	const chain = node.layout ? [...layouts, node.layout] : layouts;
	if (index === segments.length) {
		if (node.redirect)
			return { id: routeId(idParts), params, loaders: [], redirect: node.redirect };
		if (node.page) {
			return { id: routeId(idParts), params, loaders: [...chain, node.page], redirect: null };
		}
		return matchGroup(node, segments, index, params, chain, idParts);
	}

	const segment = segments[index];
	if (segment === undefined) return null;
	const children = node.children ?? [];
	for (const child of children) {
		if (child.segment.startsWith(':') || child.segment === '' || child.segment !== segment)
			continue;
		const found = matchNode(child, segments, index + 1, params, chain, [...idParts, segment]);
		if (found) return found;
	}
	for (const child of children) {
		if (!child.segment.startsWith(':')) continue;
		const name = child.segment.slice(1);
		const found = matchNode(
			child,
			segments,
			index + 1,
			{ ...params, [name]: decodeSegment(segment) },
			chain,
			[...idParts, `[${name}]`],
		);
		if (found) return found;
	}
	return matchGroup(node, segments, index, params, chain, idParts);
}

function matchGroup(
	node: RouteNode,
	segments: readonly string[],
	index: number,
	params: RouteParams,
	chain: readonly ComponentLoader[],
	idParts: readonly string[],
): RouteMatch | null {
	for (const child of node.children ?? []) {
		if (child.segment !== '') continue;
		const found = matchNode(child, segments, index, params, chain, idParts);
		if (found) return found;
	}
	return null;
}

function routeId(parts: readonly string[]): string {
	return `/${parts.join('/')}`;
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

export function routeFromHash(hash: string): string {
	const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!trimmed) return '/';
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function toRouteUrl(target: string | URL): URL {
	if (target instanceof URL) return new URL(target.href);
	return new URL(target, ROUTER_ORIGIN);
}

function navigationUrlOf(url: URL): string {
	return `${url.pathname}${url.search}${url.hash}`;
}

type HistoryCoordinates = Readonly<{
	historyIndex: number;
	navigationIndex: number;
	state: PageState;
}>;

function readCoordinates(state: unknown): HistoryCoordinates | null {
	if (!isRecord(state)) return null;
	const historyIndex = state[HISTORY_INDEX_KEY];
	const navigationIndex = state[NAVIGATION_INDEX_KEY];
	if (typeof historyIndex !== 'number' || typeof navigationIndex !== 'number') return null;
	const pageState = state[PAGE_STATE_KEY];
	return {
		historyIndex,
		navigationIndex,
		state: isPageState(pageState) ? pageState : {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isPageState(value: unknown): value is PageState {
	if (!isRecord(value)) return false;
	const directory = value.extensionDirectory;
	if (directory === undefined) return true;
	if (!isRecord(directory)) return false;
	return (
		typeof directory.workstreamId === 'string' &&
		(directory.extensionId === null || typeof directory.extensionId === 'string')
	);
}

function writeCoordinates(coordinates: HistoryCoordinates): Record<string, unknown> {
	return {
		[HISTORY_INDEX_KEY]: coordinates.historyIndex,
		[NAVIGATION_INDEX_KEY]: coordinates.navigationIndex,
		[PAGE_STATE_KEY]: coordinates.state,
	};
}

function pageOf(url: URL, match: RouteMatch | null, state: PageState): Page {
	return {
		url,
		params: match?.params ?? {},
		route: { id: match?.id ?? null },
		state,
		status: match ? 200 : 404,
		error: null,
		data: {},
		form: null,
	};
}

function targetOf(page: Page): NavigationTarget {
	return { url: page.url, params: page.params, route: page.route };
}

export class HashRouter {
	page = $state.raw<Page>(pageOf(toRouteUrl('/'), null, {}));
	navigating = $state.raw<Navigation | null>(null);
	view = $state.raw<RouterView | null>(null);

	#options: RouterStartOptions | null = null;
	#window: Window | null = null;
	#historyIndex = 0;
	#navigationIndex = 0;
	#navigationToken = 0;
	#stop: (() => void) | null = null;
	#cancelPreloadAll: (() => void) | null = null;
	readonly #loaded = new Map<ComponentLoader, Promise<RouteComponent>>();
	readonly #beforeNavigate = new Set<(navigation: BeforeNavigate) => void>();
	readonly #afterNavigate = new Set<(navigation: AfterNavigate) => void>();
	readonly #onNavigate = new Set<(navigation: Navigation) => void | Promise<void>>();

	get started(): boolean {
		return this.#options !== null;
	}

	start(options: RouterStartOptions): () => void {
		this.stop();
		this.#options = options;
		const target = options.target ?? window;
		this.#window = target;

		const coordinates = readCoordinates(target.history.state);
		this.#historyIndex = coordinates?.historyIndex ?? 0;
		this.#navigationIndex = coordinates?.navigationIndex ?? 0;
		const url = toRouteUrl(routeFromHash(target.location.hash));
		this.page = pageOf(url, matchRoute(options.routes, url.pathname), coordinates?.state ?? {});
		target.history.replaceState(
			writeCoordinates({
				historyIndex: this.#historyIndex,
				navigationIndex: this.#navigationIndex,
				state: this.page.state,
			}),
			'',
			`#${navigationUrlOf(url)}`,
		);
		navigationHistoryTargetLedger.observeEntry(target.history.state, navigationUrlOf(url));

		const onPopState = (event: PopStateEvent): void => this.#onPopState(event);
		const onClick = (event: MouseEvent): void => this.#onClick(event);
		target.addEventListener('popstate', onPopState);
		target.document.addEventListener('click', onClick);
		this.#stop = () => {
			target.removeEventListener('popstate', onPopState);
			target.document.removeEventListener('click', onClick);
		};

		void this.#navigate(url, { type: 'enter', history: 'none', state: this.page.state });
		return () => this.stop();
	}

	stop(): void {
		this.#stop?.();
		this.#stop = null;
		this.#cancelPreloadAll?.();
		this.#cancelPreloadAll = null;
		this.#options = null;
		this.#window = null;
		this.navigating = null;
	}

	goto(target: string | URL, options: GotoOptions = {}): Promise<void> {
		const url = toRouteUrl(target);
		return this.#navigate(url, {
			type: 'goto',
			history: options.replaceState ? 'replace' : 'push',
			state: options.state ?? {},
		});
	}

	pushState(target: string | URL | '', state: PageState): void {
		this.#shallow('push', target, state);
	}

	replaceState(target: string | URL | '', state: PageState): void {
		this.#shallow('replace', target, state);
	}

	async preload(...targets: readonly (string | URL)[]): Promise<void> {
		const options = this.#options;
		if (!options) return;
		await Promise.all(
			targets.map((target) => {
				const match = matchRoute(options.routes, toRouteUrl(target).pathname);
				return match ? this.#load(match.loaders) : Promise.resolve([]);
			}),
		);
	}

	async preloadAll(): Promise<void> {
		const options = this.#options;
		if (!options) return;
		await Promise.allSettled(
			[...everyLoader(options.routes), options.notFound].map((loader) => this.#load([loader])),
		);
	}

	beforeNavigate(callback: (navigation: BeforeNavigate) => void): () => void {
		this.#beforeNavigate.add(callback);
		return () => this.#beforeNavigate.delete(callback);
	}

	afterNavigate(callback: (navigation: AfterNavigate) => void): () => void {
		this.#afterNavigate.add(callback);
		return () => this.#afterNavigate.delete(callback);
	}

	onNavigate(callback: (navigation: Navigation) => void | Promise<void>): () => void {
		this.#onNavigate.add(callback);
		return () => this.#onNavigate.delete(callback);
	}

	#shallow(kind: 'push' | 'replace', target: string | URL | '', state: PageState): void {
		const win = this.#window;
		if (!win) return;
		const url = target === '' ? this.page.url : toRouteUrl(target);
		if (kind === 'push') this.#historyIndex += 1;
		const coordinates = writeCoordinates({
			historyIndex: this.#historyIndex,
			navigationIndex: this.#navigationIndex,
			state,
		});
		const hash = `#${navigationUrlOf(url)}`;
		if (kind === 'push') win.history.pushState(coordinates, '', hash);
		else win.history.replaceState(coordinates, '', hash);
		navigationHistoryTargetLedger.recordShallowCommit(
			kind,
			win.history.state,
			navigationUrlOf(url),
		);
		this.page = { ...this.page, url, state };
	}

	#onPopState(event: PopStateEvent): void {
		const win = this.#window;
		const options = this.#options;
		if (!win || !options) return;
		const coordinates = readCoordinates(event.state);
		const url = toRouteUrl(routeFromHash(win.location.hash));
		if (!coordinates) {
			void this.#navigate(url, { type: 'popstate', history: 'replace', state: {} });
			return;
		}
		const delta = coordinates.historyIndex - this.#historyIndex;
		this.#historyIndex = coordinates.historyIndex;
		if (coordinates.navigationIndex === this.#navigationIndex) {
			navigationHistoryTargetLedger.recordPopstate(event.state, navigationUrlOf(url));
			this.page = { ...this.page, url, state: coordinates.state };
			return;
		}
		this.#navigationIndex = coordinates.navigationIndex;
		void this.#navigate(url, {
			type: 'popstate',
			history: 'none',
			state: coordinates.state,
			delta,
		});
	}

	#onClick(event: MouseEvent): void {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
		if (!(anchor instanceof HTMLAnchorElement)) return;
		if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
		if (anchor.getAttribute('rel')?.split(/\s+/u).includes('external')) return;
		const href = anchor.getAttribute('href') ?? '';
		if (href.startsWith('/') && !href.startsWith('//')) {
			event.preventDefault();
			void this.#navigate(toRouteUrl(href), { type: 'link', history: 'push', state: {} });
			return;
		}
		if (/^https?:\/\//iu.test(href)) {
			event.preventDefault();
			this.#openExternal(href);
		}
	}

	#openExternal(url: string): void {
		const open = this.#options?.openExternalUrl;
		if (open) {
			open(url);
			return;
		}
		void invoke('app.open-external-url', { url }).catch(() => undefined);
	}

	async #navigate(
		url: URL,
		input: Readonly<{
			type: NavigationType;
			history: 'push' | 'replace' | 'none';
			state: PageState;
			delta?: number;
		}>,
	): Promise<void> {
		const options = this.#options;
		const win = this.#window;
		if (!options || !win) return;

		let match = matchRoute(options.routes, url.pathname);
		if (match?.redirect) {
			return this.#navigate(toRouteUrl(match.redirect), {
				...input,
				history: input.history === 'none' ? 'replace' : input.history,
			});
		}

		const from = targetOf(this.page);
		const to: NavigationTarget = {
			url,
			params: match?.params ?? {},
			route: { id: match?.id ?? null },
		};
		let settle: () => void = () => undefined;
		const complete = new Promise<void>((resolve) => {
			settle = resolve;
		});
		let cancelled = false;
		const navigation: BeforeNavigate = {
			from,
			to,
			type: input.type,
			willUnload: false,
			...(input.delta !== undefined ? { delta: input.delta } : {}),
			complete,
			cancel: () => {
				cancelled = true;
			},
		};
		for (const callback of [...this.#beforeNavigate]) callback(navigation);
		if (cancelled) {
			settle();
			return;
		}

		const token = ++this.#navigationToken;
		this.navigating = navigation;
		let components: readonly RouteComponent[];
		try {
			components = await this.#load(match ? match.loaders : [options.notFound]);
			await Promise.all([...this.#onNavigate].map((callback) => callback(navigation)));
		} catch (error) {
			if (token === this.#navigationToken) this.navigating = null;
			settle();
			throw error;
		}
		if (token !== this.#navigationToken) {
			settle();
			return;
		}

		if (input.history !== 'none') {
			if (input.history === 'push') this.#historyIndex += 1;
			this.#navigationIndex += 1;
			const coordinates = writeCoordinates({
				historyIndex: this.#historyIndex,
				navigationIndex: this.#navigationIndex,
				state: input.state,
			});
			const hash = `#${navigationUrlOf(url)}`;
			if (input.history === 'push') win.history.pushState(coordinates, '', hash);
			else win.history.replaceState(coordinates, '', hash);
		}

		match = match ?? null;
		navigationHistoryTargetLedger.reconcileAfterNavigate(
			win.history.state,
			navigationUrlOf(url),
			input.type,
		);
		this.page = pageOf(url, match, input.state);
		this.view = { match, components };
		this.navigating = null;
		settle();
		for (const callback of [...this.#afterNavigate]) callback(navigation);
		if (input.type === 'enter') this.#preloadAllAfterPaint(options);
	}

	#preloadAllAfterPaint(options: RouterStartOptions): void {
		this.#cancelPreloadAll?.();
		const cancel = scheduleAfterNavigationPaint(() => {
			cancel();
			if (this.#cancelPreloadAll === cancel) this.#cancelPreloadAll = null;
			if (this.#options === options) void this.preloadAll();
		});
		this.#cancelPreloadAll = cancel;
	}

	#load(loaders: readonly ComponentLoader[]): Promise<RouteComponent[]> {
		return Promise.all(
			loaders.map((loader) => {
				let pending = this.#loaded.get(loader);
				if (!pending) {
					pending = (async () => {
						const module = await loader();
						return module.default;
					})();
					pending.catch(() => this.#loaded.delete(loader));
					this.#loaded.set(loader, pending);
				}
				return pending;
			}),
		);
	}
}

export const router = new HashRouter();

function everyLoader(node: RouteNode): ComponentLoader[] {
	const own = [node.layout, node.page].filter((loader) => loader !== undefined);
	return [...own, ...(node.children ?? []).flatMap(everyLoader)];
}
