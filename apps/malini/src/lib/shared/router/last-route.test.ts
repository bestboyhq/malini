import { describe, expect, it } from 'vitest';
import type { RouteNode } from '$shared/router/hash-router.svelte';
import { bootRoute, migrateRememberedRoute } from './last-route';

const page = (): Promise<never> => Promise.reject(new Error('page fixture is never loaded'));

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			page,
			children: [
				{ segment: 'workstreams', children: [{ segment: ':workstreamId', page }] },
				{ segment: 'settings', page },
			],
		},
	],
};

describe('bootRoute', () => {
	it('boots into the remembered route when the window opens bare', () => {
		expect(bootRoute('', '/workstreams/ws-1?agent=s-7', routes)).toBe(
			'/workstreams/ws-1?agent=s-7',
		);
		expect(bootRoute('#/', '/settings', routes)).toBe('/settings');
	});

	it('respects a hash that was actually asked for', () => {
		expect(bootRoute('#/settings', '/workstreams/ws-1', routes)).toBe('/settings');
	});

	it('falls back to the root when nothing is remembered', () => {
		expect(bootRoute('', null, routes)).toBe('/');
	});

	it('drops a remembered route the table no longer knows', () => {
		expect(bootRoute('', '/routines/old', routes)).toBe('/');
		expect(bootRoute('', '/', routes)).toBe('/');
	});
});

describe('migrateRememberedRoute', () => {
	it('moves the old workstreams tree onto the new one', () => {
		expect(migrateRememberedRoute('/agentic')).toBe('/');
		expect(migrateRememberedRoute('/agentic/ws-1?agent=s-7')).toBe('/workstreams/ws-1?agent=s-7');
		expect(migrateRememberedRoute('/agentic/ws-1?agent=s-7#top')).toBe(
			'/workstreams/ws-1?agent=s-7#top',
		);
		expect(migrateRememberedRoute('/agentic?inspector=extensions')).toBe('/?inspector=extensions');
	});

	it('leaves a route that never lived under the old tree alone', () => {
		expect(migrateRememberedRoute('/settings')).toBe('/settings');
		expect(migrateRememberedRoute('/routines')).toBe('/routines');
		expect(migrateRememberedRoute('/workstreams/ws-1')).toBe('/workstreams/ws-1');
	});
});
