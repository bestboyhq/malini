import { describe, expect, it } from 'vitest';
import type { NavigationTarget } from './hash-router.svelte';
import { navigationTargetsWorkstream, openingWorkstreamId } from './navigation-target';
import { workstreamHref, workstreamIdFromPathname } from './routes-hrefs';

function target(pathname: string, params: Record<string, string>): NavigationTarget {
	return {
		url: new URL(pathname, 'http://malini.local'),
		params,
		route: { id: pathname },
	};
}

describe('navigationTargetsWorkstream', () => {
	it('treats a settled router as still on the workstream', () => {
		expect(navigationTargetsWorkstream(null, 'ws-1')).toBe(true);
	});

	it('matches on the route parameter, not on a parsed pathname', () => {
		expect(
			navigationTargetsWorkstream(target('/workstreams/ws%2F1', { workstreamId: 'ws/1' }), 'ws/1'),
		).toBe(true);
		expect(
			navigationTargetsWorkstream(target('/workstreams/ws-2', { workstreamId: 'ws-2' }), 'ws-1'),
		).toBe(false);
		expect(navigationTargetsWorkstream(target('/', {}), 'ws-1')).toBe(false);
	});
});

describe('openingWorkstreamId', () => {
	it('names the workstream a navigation is opening', () => {
		expect(openingWorkstreamId(target('/workstreams/ws-2', { workstreamId: 'ws-2' }), 'ws-1')).toBe(
			'ws-2',
		);
		expect(
			openingWorkstreamId(target('/workstreams/ws-1', { workstreamId: 'ws-1' }), 'ws-1'),
		).toBeNull();
		expect(openingWorkstreamId(target('/settings', {}), 'ws-1')).toBeNull();
		expect(openingWorkstreamId(null, 'ws-1')).toBeNull();
	});
});

describe('workstreamHref', () => {
	it('encodes the id and appends only the options that are set', () => {
		expect(workstreamHref('workstream/one')).toBe('/workstreams/workstream%2Fone');
		expect(workstreamHref('workstream/one', { agentSessionId: 'agent?one' })).toBe(
			'/workstreams/workstream%2Fone?agent=agent%3Fone',
		);
		expect(
			workstreamHref('ws-1', {
				agentSessionId: 'agent-1',
				inspector: 'extensions',
				extension: 'example.terminal',
			}),
		).toBe('/workstreams/ws-1?agent=agent-1&inspector=extensions&extension=example.terminal');
	});

	it('reads the id back out of a pathname', () => {
		expect(workstreamIdFromPathname('/workstreams/ws-1')).toBe('ws-1');
		expect(workstreamIdFromPathname('/settings')).toBeNull();
		expect(workstreamIdFromPathname('/workstreams')).toBeNull();
	});
});
