import { matchRoute, routeFromHash, type RouteNode } from './hash-router.svelte';

const LAST_ROUTE_KEY = 'malini.app.last-route.v2';
const LEGACY_LAST_ROUTE_KEY = 'malini.app.last-route-v1';
const LEGACY_WORKSTREAMS_ROOT = '/agentic';

export function bootRoute(hash: string, remembered: string | null, routes: RouteNode): string {
	const requested = routeFromHash(hash);
	if (requested !== '/') return requested;
	if (!remembered) return requested;
	const pathname = remembered.split(/[?#]/u, 1)[0] ?? '';
	if (pathname === '/' || !matchRoute(routes, pathname)) return requested;
	return remembered;
}

export function migrateRememberedRoute(route: string): string {
	const root = LEGACY_WORKSTREAMS_ROOT;
	if (route === root) return '/';
	if (route.startsWith(`${root}/`)) return `/workstreams/${route.slice(root.length + 1)}`;
	if (route.startsWith(`${root}?`) || route.startsWith(`${root}#`)) {
		return `/${route.slice(root.length)}`;
	}
	return route;
}

export function readLastRoute(): string | null {
	const current = readStoredRoute(LAST_ROUTE_KEY);
	if (current !== null) return current;

	const legacy = readStoredRoute(LEGACY_LAST_ROUTE_KEY);
	if (legacy === null) return null;

	const migrated = migrateRememberedRoute(legacy);
	try {
		globalThis.localStorage?.setItem(LAST_ROUTE_KEY, migrated);
		globalThis.localStorage?.removeItem(LEGACY_LAST_ROUTE_KEY);
	} catch {}
	return migrated;
}

export function rememberLastRoute(url: URL): void {
	const route = `${url.pathname}${url.search}${url.hash}`;
	try {
		if (url.pathname === '/') globalThis.localStorage?.removeItem(LAST_ROUTE_KEY);
		else globalThis.localStorage?.setItem(LAST_ROUTE_KEY, route);
	} catch {}
}

function readStoredRoute(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}
