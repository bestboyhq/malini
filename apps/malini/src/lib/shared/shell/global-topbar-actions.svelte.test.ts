import { describe, expect, it, vi } from 'vitest';

import {
	globalTopBarActionMatchesPathname,
	globalTopBarGithubStatus,
	GlobalTopBarActionRegistry,
	type GlobalTopBarGithubStatus,
} from './global-topbar-actions.svelte';

function action(id: string, label = id) {
	return {
		id,
		label,
		ariaLabel: label,
		tooltip: label,
		onInvoke: vi.fn(),
	} as const;
}

describe('GlobalTopBarActionRegistry', () => {
	it('publishes route-owned actions and removes hidden registrations', () => {
		const registry = new GlobalTopBarActionRegistry();
		const registration = registry.register('pull-requests.top-bar');

		registration.update(action('create-pr', 'Create PR'));
		expect(registry.actions.map(({ label }) => label)).toEqual(['Create PR']);

		registration.update(null);
		expect(registry.actions).toEqual([]);
	});

	it('does not let an outgoing route dispose the replacement action', () => {
		const registry = new GlobalTopBarActionRegistry();
		const outgoing = registry.register('pull-requests.top-bar');
		outgoing.update(action('old', 'Create PR'));

		const incoming = registry.register('pull-requests.top-bar');
		incoming.update(action('new', 'Open PR'));
		outgoing.dispose();

		expect(registry.actions.map(({ id }) => id)).toEqual(['new']);
		incoming.dispose();
		expect(registry.actions).toEqual([]);
	});
});

describe('globalTopBarActionMatchesPathname', () => {
	it('keeps a workstream action scoped to concrete workstream routes in one workstream', () => {
		const scoped = {
			...action('create-pr', 'Create PR'),
			scope: { pathPrefix: '/app/workstreams/', minimumSegments: 3 },
		};

		expect(globalTopBarActionMatchesPathname(scoped, '/app/workstreams/workstream-one')).toBe(true);
		expect(
			globalTopBarActionMatchesPathname(scoped, '/app/workstreams/workstream-one/extensions'),
		).toBe(true);
		expect(globalTopBarActionMatchesPathname(scoped, '/app/workstreams/workstream-one-more')).toBe(
			true,
		);
		expect(globalTopBarActionMatchesPathname(scoped, '/app/workstreams/workstream-two')).toBe(true);
		expect(globalTopBarActionMatchesPathname(scoped, '/app/workstreams')).toBe(false);
		expect(globalTopBarActionMatchesPathname(scoped, '/other/workstreams/workstream-one')).toBe(
			false,
		);
		expect(globalTopBarActionMatchesPathname(scoped, '/app/threads')).toBe(false);
	});

	it('leaves unscoped global actions visible', () => {
		expect(globalTopBarActionMatchesPathname(action('global'), '/anywhere')).toBe(true);
	});
});

function githubStatus(overrides: Partial<GlobalTopBarGithubStatus> = {}): GlobalTopBarGithubStatus {
	return {
		reference: '#128',
		title: 'Move GitHub status to the top bar',
		branch: 'feature/review → main',
		url: 'https://example.test/pull/128',
		checks: [],
		checksSummary: 'Checks passed',
		review: null,
		todos: null,
		action: null,
		...overrides,
	};
}

describe('global top bar GitHub status', () => {
	it('carries no status vocabulary beside the next action', () => {
		const status: Record<string, unknown> = githubStatus();
		for (const field of ['summary', 'tone', 'blockingCount']) {
			expect(field in status).toBe(false);
		}
	});

	it('keeps the last published status so the detail survives leaving the workstream route', () => {
		globalTopBarGithubStatus.publish('workstream-one', githubStatus());
		expect(globalTopBarGithubStatus.current?.reference).toBe('#128');

		globalTopBarGithubStatus.publish(
			'workstream-one',
			githubStatus({ checksSummary: '1 failing' }),
		);
		expect(globalTopBarGithubStatus.current?.checksSummary).toBe('1 failing');

		globalTopBarGithubStatus.clear('workstream-one');
		expect(globalTopBarGithubStatus.current).toBeNull();
	});

	it('does not let an outgoing workstream clear the incoming workstream status', () => {
		globalTopBarGithubStatus.publish('workstream-one', githubStatus({ reference: '#1' }));
		globalTopBarGithubStatus.publish('workstream-two', githubStatus({ reference: '#2' }));

		globalTopBarGithubStatus.clear('workstream-one');

		expect(globalTopBarGithubStatus.current?.reference).toBe('#2');
		globalTopBarGithubStatus.clear('workstream-two');
		expect(globalTopBarGithubStatus.current).toBeNull();
	});
});
