import { afterEach, describe, expect, it } from 'vitest';
import { readLastRoute, rememberLastRoute } from './last-route';

describe('last route storage', () => {
	afterEach(() => {
		globalThis.localStorage.clear();
	});

	it('round-trips the path, query and hash', () => {
		rememberLastRoute(new URL('http://router.local/workstreams/ws-1?agent=s-7#top'));
		expect(globalThis.localStorage.getItem('malini.app.last-route.v2')).toBe(
			'/workstreams/ws-1?agent=s-7#top',
		);
		expect(readLastRoute()).toBe('/workstreams/ws-1?agent=s-7#top');
	});

	it('forgets the route on the root', () => {
		rememberLastRoute(new URL('http://router.local/workstreams/ws-1'));
		rememberLastRoute(new URL('http://router.local/'));
		expect(readLastRoute()).toBeNull();
	});

	it('migrates the v1 key onto the workstreams tree once', () => {
		globalThis.localStorage.setItem('malini.app.last-route-v1', '/agentic/ws-1?agent=s-7');

		expect(readLastRoute()).toBe('/workstreams/ws-1?agent=s-7');
		expect(globalThis.localStorage.getItem('malini.app.last-route.v2')).toBe(
			'/workstreams/ws-1?agent=s-7',
		);
		expect(globalThis.localStorage.getItem('malini.app.last-route-v1')).toBeNull();
	});

	it('leaves the v2 key alone when a stale v1 key is still around', () => {
		globalThis.localStorage.setItem('malini.app.last-route.v2', '/settings');
		globalThis.localStorage.setItem('malini.app.last-route-v1', '/agentic/ws-1');

		expect(readLastRoute()).toBe('/settings');
	});
});
