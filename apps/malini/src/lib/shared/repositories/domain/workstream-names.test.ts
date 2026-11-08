import { describe, expect, it } from 'vitest';
import type { Workstream } from '$shared/repositories/domain/workstream';
import {
	displayWorkstreamName,
	isPlaceholderWorkstreamName,
	takenWorkstreamNames,
	uniqueWorkstreamName,
} from '$shared/repositories/domain/workstream-names';

function workstreamNamed(name: string, status: Workstream['status']): Workstream {
	return {
		id: `id-${name}`,
		projectId: 'project',
		name,
		path: '/tmp/checkout',
		branch: 'malini/branch',
		baseBranch: 'main',
		status,
		createdAt: '2026-10-24T00:00:00.000Z',
		activeAt: '2026-10-24T00:00:00.000Z',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
		scope: null,
		startedBy: null,
	};
}

describe('workstream names', () => {
	it('does not display base branch names as workstream names', () => {
		expect(
			displayWorkstreamName({
				name: 'main',
				baseBranch: 'main',
			}),
		).toBe('New workstream');
		expect(
			displayWorkstreamName({
				name: 'develop',
				baseBranch: '',
			}),
		).toBe('New workstream');
		expect(
			displayWorkstreamName(
				{
					name: 'bookstore / main',
					baseBranch: 'master',
				},
				'szymeo/bookstore',
			),
		).toBe('New workstream');
	});

	it('keeps intentional custom names', () => {
		expect(
			displayWorkstreamName({
				name: 'Checkout billing fix',
				baseBranch: 'main',
			}),
		).toBe('Checkout billing fix');
	});

	it('calls a lead chat New chat until it is named', () => {
		const lead = { baseBranch: 'main', scope: 'home' };
		expect(displayWorkstreamName({ ...lead, name: 'New workstream 2' })).toBe('New chat');
		expect(displayWorkstreamName({ ...lead, name: 'Move apps to Logdash' })).toBe(
			'Move apps to Logdash',
		);
	});

	it('drops repository prefixes when the workstream is already nested under the repository', () => {
		expect(
			displayWorkstreamName(
				{
					name: 'blog.dev / Fix nav',
					baseBranch: 'main',
				},
				'szymeo/blog.dev',
			),
		).toBe('Fix nav');
		expect(
			displayWorkstreamName(
				{
					name: 'szymeo/blog.dev: Tune layout',
					baseBranch: 'main',
				},
				'szymeo/blog.dev',
			),
		).toBe('Tune layout');
	});

	it('calls a new workstream New workstream, numbered when another workstream holds that name', () => {
		expect(uniqueWorkstreamName(['Login bug'])).toBe('New workstream');
		expect(uniqueWorkstreamName(['  NEW WORKSTREAM ', 'New workstream 2'])).toBe(
			'New workstream 3',
		);
	});

	it('frees the names of archived workstreams', () => {
		expect(
			takenWorkstreamNames([
				workstreamNamed('Lunar Relay', 'active'),
				workstreamNamed('Swift Harbor', 'archived'),
			]),
		).toEqual(['Lunar Relay', 'Lunar Relay']);
	});
});

describe('isPlaceholderWorkstreamName', () => {
	it('recognizes the placeholder, with or without a number, and nothing the namer chose', () => {
		expect(
			['New workstream', 'New workstream 2', ' New workstream 12 '].every(
				isPlaceholderWorkstreamName,
			),
		).toBe(true);
		expect(
			['Feature flags', 'New workstream flow', 'new workstream', 'Bright Arc'].some(
				isPlaceholderWorkstreamName,
			),
		).toBe(false);
	});
});
