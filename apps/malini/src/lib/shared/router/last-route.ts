import { matchRoute, routeFromHash, type RouteNode } from './hash-router.svelte';

const LAST_ROUTE_KEY = 'malini.app.last-route.v2';

export function bootRoute(hash: string, remembered: string | null, routes: RouteNode): string {
	const requested = routeFromHash(hash);
	if (requested !== '/') return requested;
	if (!remembered) return requested;
	const pathname = remembered.split(/[?#]/u, 1)[0] ?? '';
	if (pathname === '/') return requested;
	const match = matchRoute(routes, pathname);
	if (!match) return requested;
	return match.redirect ?? remembered;
}

export function readLastRoute(): string | null {
	try {
		return globalThis.localStorage?.getItem(LAST_ROUTE_KEY) ?? null;
	} catch {
		return null;
	}
}

export function rememberLastRoute(url: URL): void {
	const route = `${url.pathname}${url.search}${url.hash}`;
	try {
		if (url.pathname === '/') globalThis.localStorage?.removeItem(LAST_ROUTE_KEY);
		else globalThis.localStorage?.setItem(LAST_ROUTE_KEY, route);
	} catch {}
}
