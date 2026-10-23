import { describe, expect, it } from 'vitest';
import { routes as appRoutes } from '$lib/app/routes';
import type { RouteNode } from '$shared/router/hash-router.svelte';
import { bootRoute } from './last-route';

const page = (): Promise<never> => Promise.reject(new Error('page fixture is never loaded'));

const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			page,
			children: [
				{ segment: 'workstreams', children: [{ segment: ':workstreamId', page }] },
				{ segment: 'jobs', page },
			],
		},
	],
};

describe('bootRoute', () => {
	it('boots into the remembered route when the window opens bare', () => {
		expect(bootRoute('', '/workstreams/ws-1?agent=s-7', routes)).toBe(
			'/workstreams/ws-1?agent=s-7',
		);
		expect(bootRoute('#/', '/jobs', routes)).toBe('/jobs');
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

	it('follows a remembered route that moved to where it went', () => {
		expect(bootRoute('', '/jobs/routines', appRoutes)).toBe('/jobs');
		expect(bootRoute('', '/jobs/activity', appRoutes)).toBe('/jobs/activity');
	});
});
