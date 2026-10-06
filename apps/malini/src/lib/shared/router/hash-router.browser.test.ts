import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import {
	HISTORY_INDEX_KEY,
	NAVIGATION_INDEX_KEY,
	navigationHistoryTargetLedger,
} from '$shared/router/history-ledger';
import Router from './Router.svelte';
import { FixtureLayoutInstances } from './fixtures/FixtureLayout.svelte';
import { router, type ComponentLoader, type RouteNode } from './hash-router.svelte';

const routes: RouteNode = {
	segment: '',
	redirect: '/items',
	children: [
		{
			segment: 'items',
			layout: () => import('./fixtures/FixtureLayout.svelte'),
			page: () => import('./fixtures/FixturePage.svelte'),
			children: [{ segment: ':itemId', page: () => import('./fixtures/FixturePage.svelte') }],
		},
	],
};
const notFound = () => import('./fixtures/FixtureNotFound.svelte');

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;
let openExternalUrl: ReturnType<typeof vi.fn<(url: string) => void>>;

async function settle(): Promise<void> {
	for (let i = 0; i < 50 && router.navigating; i += 1) {
		await router.navigating.complete;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (let i = 0; i < 20; i += 1) await Promise.resolve();
	flushSync();
}

function element(testId: string): HTMLElement | null {
	return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function coordinates(): { history: number; navigation: number } {
	const state: Record<string, number | undefined> = window.history.state;
	return {
		history: state[HISTORY_INDEX_KEY] ?? -1,
		navigation: state[NAVIGATION_INDEX_KEY] ?? -1,
	};
}

beforeEach(() => {
	window.history.replaceState(null, '', '#/items');
	host = document.createElement('div');
	document.body.append(host);
	openExternalUrl = vi.fn<(url: string) => void>();
	FixtureLayoutInstances.count = 0;
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	setPlatformForTest(null);
});

describe('the hash router', () => {
	it('reads the entering route synchronously and renders it once loaded', async () => {
		router.start({ routes, notFound, openExternalUrl });
		expect(router.page.url.pathname).toBe('/items');
		expect(router.page.route.id).toBe('/items');
		expect(coordinates()).toEqual({ history: 0, navigation: 0 });

		app = mount(Router, { target: host, props: {}, context: new Map() });
		await settle();

		expect(element('fixture-layout')).not.toBeNull();
		expect(element('fixture-page')?.dataset.routeId).toBe('/items');
	});

	it('goto pushes a history entry with ledger coordinates and keeps the layout instance', async () => {
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await settle();
		const before = element('fixture-layout')?.dataset.instance;

		const after: string[] = [];
		const release = router.afterNavigate(({ to, type }) =>
			after.push(`${type}:${to?.url.pathname}`),
		);
		await router.goto('/items/first?tab=files');
		await settle();
		release();

		expect(window.location.hash).toBe('#/items/first?tab=files');
		expect(coordinates()).toEqual({ history: 1, navigation: 1 });
		expect(router.page.params).toEqual({ itemId: 'first' });
		expect(router.page.url.searchParams.get('tab')).toBe('files');
		expect(router.navigating).toBeNull();
		expect(after).toEqual(['goto:/items/first']);
		expect(element('fixture-layout')?.dataset.instance).toBe(before);
		expect(FixtureLayoutInstances.count).toBe(1);
		expect(element('fixture-page')?.dataset.routeId).toBe('/items/[itemId]');
	});

	it('exposes the in-flight target on navigating until the route commits', async () => {
		router.start({ routes, notFound, openExternalUrl });
		await settle();
		const pending = router.goto('/items/first');

		expect(router.navigating?.to?.url.pathname).toBe('/items/first');
		expect(router.navigating?.from?.url.pathname).toBe('/items');
		await pending;
		expect(router.navigating).toBeNull();
	});

	it('follows a redirect with a replace rather than a push', async () => {
		window.history.replaceState(null, '', '');
		router.start({ routes, notFound, openExternalUrl });
		await settle();

		expect(window.location.hash).toBe('#/items');
		expect(coordinates().history).toBe(0);
	});

	it('turns an anchor click into a navigation and an external one into openExternalUrl', async () => {
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await settle();

		host.querySelector<HTMLAnchorElement>('[data-testid="fixture-link"]')?.click();
		await settle();
		expect(router.page.url.pathname).toBe('/items/second');
		expect(window.location.hash).toBe('#/items/second');

		host.querySelector<HTMLAnchorElement>('[data-testid="fixture-external"]')?.click();
		expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/docs');
		expect(router.page.url.pathname).toBe('/items/second');
	});

	it('opens an external link in the system browser when the app supplies no opener', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		router.start({ routes, notFound });
		app = mount(Router, { target: host });
		await settle();

		host.querySelector<HTMLAnchorElement>('[data-testid="fixture-external"]')?.click();

		expect(fake.calls).toEqual([
			{ command: 'app.open-external-url', args: { url: 'https://example.test/docs' } },
		]);
		expect(router.page.url.pathname).toBe('/items');
	});

	it('lets beforeNavigate cancel and leaves page and history untouched', async () => {
		router.start({ routes, notFound, openExternalUrl });
		await settle();
		const release = router.beforeNavigate((navigation) => navigation.cancel());

		await router.goto('/items/first');
		release();

		expect(router.page.url.pathname).toBe('/items');
		expect(window.location.hash).toBe('#/items');
		expect(coordinates()).toEqual({ history: 0, navigation: 0 });
	});

	it('pushState is shallow: new entry and page.state, same navigation index', async () => {
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await settle();

		router.pushState('', {
			extensionDirectory: { workstreamId: 'w', extensionId: 'x' },
		});
		flushSync();

		expect(router.page.state.extensionDirectory?.extensionId).toBe('x');
		expect(coordinates()).toEqual({ history: 1, navigation: 0 });
		expect(element('fixture-page')?.dataset.routeId).toBe('/items');
	});

	it('restores a popped entry: shallow ones by state, full ones by loading the route', async () => {
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await settle();
		await router.goto('/items/first');
		await settle();
		const entry = window.history.state;

		window.history.replaceState(null, '', '#/items');
		window.dispatchEvent(
			new PopStateEvent('popstate', {
				state: { [HISTORY_INDEX_KEY]: 0, [NAVIGATION_INDEX_KEY]: 0 },
			}),
		);
		await settle();
		expect(router.page.url.pathname).toBe('/items');
		expect(router.page.route.id).toBe('/items');

		window.history.replaceState(entry, '', '#/items/first');
		window.dispatchEvent(new PopStateEvent('popstate', { state: entry }));
		await settle();
		expect(router.page.url.pathname).toBe('/items/first');
		expect(element('fixture-page')?.dataset.routeId).toBe('/items/[itemId]');
		expect(FixtureLayoutInstances.count).toBe(1);
	});

	it('feeds the history ledger so an adjacent forward entry is predictable after back', async () => {
		navigationHistoryTargetLedger.reset();
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await settle();
		await router.goto('/items/first');
		await settle();

		const back = navigationHistoryTargetLedger.adjacent('back', window.history.state);
		expect(back?.targetUrl).toBe('/items');

		window.history.replaceState(null, '', '#/items');
		window.dispatchEvent(
			new PopStateEvent('popstate', {
				state: { [HISTORY_INDEX_KEY]: 0, [NAVIGATION_INDEX_KEY]: 0 },
			}),
		);
		await settle();
		const forward = navigationHistoryTargetLedger.adjacent('forward', {
			[HISTORY_INDEX_KEY]: 0,
			[NAVIGATION_INDEX_KEY]: 0,
		});
		expect(forward?.targetUrl).toBe('/items/first');
	});

	it('renders the not-found component for a path no route ends at', async () => {
		router.start({ routes, notFound, openExternalUrl });
		app = mount(Router, { target: host });
		await router.goto('/nowhere');
		await settle();

		expect(router.page.route.id).toBeNull();
		expect(router.page.status).toBe(404);
		expect(element('fixture-not-found')).not.toBeNull();
	});
});

describe('route modules', () => {
	const fetched: string[] = [];

	function chunk(name: string): ComponentLoader {
		return async () => {
			fetched.push(name);
			await new Promise((resolve) => setTimeout(resolve, 0));
			return import('./fixtures/FixturePage.svelte');
		};
	}

	function lazyRoutes(): RouteNode {
		return {
			segment: '',
			children: [
				{
					segment: '',
					layout: chunk('shell'),
					page: chunk('home'),
					children: [{ segment: 'items', children: [{ segment: ':itemId', page: chunk('item') }] }],
				},
				{ segment: 'settings', page: chunk('settings') },
			],
		};
	}

	beforeEach(() => {
		fetched.length = 0;
		window.history.replaceState(null, '', '#/');
	});

	it('fetches every route module once the entering route has painted', async () => {
		router.start({ routes: lazyRoutes(), notFound: chunk('not-found') });
		app = mount(Router, { target: host });
		await settle();

		await vi.waitFor(() =>
			expect([...fetched].sort()).toEqual(['home', 'item', 'not-found', 'settings', 'shell']),
		);
	});

	it('commits a navigation to a preloaded route within the same task', async () => {
		router.start({ routes: lazyRoutes(), notFound: chunk('not-found') });
		app = mount(Router, { target: host });
		await settle();
		await vi.waitFor(() => expect(fetched).toHaveLength(5));
		await router.preloadAll();

		let committedBeforeNextTask = false;
		setTimeout(() => {
			committedBeforeNextTask = router.page.url.pathname === '/settings';
		}, 0);
		void router.goto('/settings');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(committedBeforeNextTask).toBe(true);
		expect(fetched).toHaveLength(5);
	});

	it('fetches nothing more once the router has stopped', async () => {
		router.start({ routes: lazyRoutes(), notFound: chunk('not-found') });
		app = mount(Router, { target: host });
		await settle();
		router.stop();
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect([...fetched].sort()).toEqual(['home', 'shell']);
	});
});
