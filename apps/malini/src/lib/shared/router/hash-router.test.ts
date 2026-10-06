import { describe, expect, it } from 'vitest';
import {
	matchRoute,
	routeFromHash,
	toRouteUrl,
	type ComponentLoader,
	type RouteNode,
} from './hash-router.svelte';

const fixtureNames = new WeakMap<ComponentLoader, string>();

const load = (name: string): ComponentLoader => {
	const loader = (): Promise<never> => Promise.reject(new Error(`not loaded: ${name}`));
	fixtureNames.set(loader, name);
	return loader;
};

const name = (loader: ComponentLoader): string => fixtureNames.get(loader) ?? '';

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: load('workstreams-layout'),
			page: load('repositories'),
			children: [
				{
					segment: 'extensions',
					page: load('directory'),
					children: [{ segment: ':extensionId', page: load('directory-detail') }],
				},
				{
					segment: 'workstreams',
					children: [
						{
							segment: ':workstreamId',
							layout: load('workstream-layout'),
							page: load('workstream'),
							children: [
								{
									segment: 'extensions',
									page: load('workstream-extensions'),
									children: [{ segment: ':extensionId', page: load('workstream-extension') }],
								},
							],
						},
					],
				},
				{ segment: 'settings', page: load('settings') },
			],
		},
		{ segment: 'dev', children: [{ segment: 'runtime', page: load('runtime') }] },
	],
};

describe('matchRoute', () => {
	it('nests layouts outermost first and ends with the page', () => {
		const match = matchRoute(routes, '/workstreams/ws-1/extensions/browser');

		expect(match?.id).toBe('/workstreams/[workstreamId]/extensions/[extensionId]');
		expect(match?.params).toEqual({ workstreamId: 'ws-1', extensionId: 'browser' });
		expect(match?.loaders.map(name)).toEqual([
			'workstreams-layout',
			'workstream-layout',
			'workstream-extension',
		]);
	});

	it('carries a pathless group layout without spending a segment or an id part', () => {
		expect(matchRoute(routes, '/')).toEqual({
			id: '/',
			params: {},
			loaders: [expect.any(Function), expect.any(Function)],
			redirect: null,
		});
		expect(matchRoute(routes, '/')?.loaders.map(name)).toEqual([
			'workstreams-layout',
			'repositories',
		]);
		expect(matchRoute(routes, '/settings')?.id).toBe('/settings');
		expect(matchRoute(routes, '/settings')?.loaders.map(name)).toEqual([
			'workstreams-layout',
			'settings',
		]);
		expect(matchRoute(routes, '/dev/runtime')?.loaders.map(name)).toEqual(['runtime']);
	});

	it('lets a literal segment win over a parameter at the same depth', () => {
		expect(matchRoute(routes, '/extensions')?.id).toBe('/extensions');
		expect(matchRoute(routes, '/extensions/browser')?.loaders.map(name)).toEqual([
			'workstreams-layout',
			'directory-detail',
		]);
		expect(matchRoute(routes, '/workstreams/ws-1')?.id).toBe('/workstreams/[workstreamId]');
	});

	it('reports a redirect instead of loaders for a node that only redirects', () => {
		expect(matchRoute({ segment: '', redirect: '/settings' }, '/')).toEqual({
			id: '/',
			params: {},
			loaders: [],
			redirect: '/settings',
		});
	});

	it('decodes parameter segments and ignores a trailing slash', () => {
		expect(matchRoute(routes, '/workstreams/a%20b/')?.params).toEqual({ workstreamId: 'a b' });
	});

	it('returns null for a path no node ends at', () => {
		expect(matchRoute(routes, '/dev')).toBeNull();
		expect(matchRoute(routes, '/workstreams')).toBeNull();
		expect(matchRoute(routes, '/workstreams/ws-1/unknown')).toBeNull();
		expect(matchRoute(routes, '/elsewhere')).toBeNull();
	});
});

describe('route urls', () => {
	it('reads the route out of the hash, defaulting to the root', () => {
		expect(routeFromHash('')).toBe('/');
		expect(routeFromHash('#')).toBe('/');
		expect(routeFromHash('#/routines?agent=1')).toBe('/routines?agent=1');
		expect(routeFromHash('#routines')).toBe('/routines');
	});

	it('parses a route against the synthetic origin so pathname and search compare cleanly', () => {
		const url = toRouteUrl('/workstreams/ws-1?agent=session#anchor');
		expect(url.pathname).toBe('/workstreams/ws-1');
		expect(url.searchParams.get('agent')).toBe('session');
		expect(url.origin).toBe('http://malini.local');
	});
});
