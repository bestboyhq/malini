import { describe, expect, it } from 'vitest';
import type { Workstream } from '$shared/repositories/domain/workstream';
import {
	displayWorkstreamName,
	generatedWorkstreamName,
	takenWorkstreamNames,
	uniqueWorkstreamName,
} from '$shared/repositories/domain/workstream-names';

const EVERY_GENERATED_NAME = Array.from({ length: 5_000 }, (_, index) =>
	generatedWorkstreamName(`seed-${index}`),
);

function workstreamNamed(name: string, status: Workstream['status']): Workstream {
	return {
		id: `id-${name}`,
		projectId: 'project',
		name,
		path: '/tmp/checkout',
		branch: 'malini/branch',
		baseBranch: 'main',
		status,
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	};
}

describe('workstream names', () => {
	it('generates stable non-branch names from ids', () => {
		const first = generatedWorkstreamName('workstream-1');
		expect(first).toBe(generatedWorkstreamName('workstream-1'));
		expect(first).not.toBe('main');
	});

	it('does not display base branch names as workstream names', () => {
		expect(
			displayWorkstreamName({
				id: 'workstream-main',
				name: 'main',
				baseBranch: 'main',
			}),
		).toBe(generatedWorkstreamName('workstream-main'));
		expect(
			displayWorkstreamName({
				id: 'workstream-empty-base',
				name: 'develop',
				baseBranch: '',
			}),
		).toBe(generatedWorkstreamName('workstream-empty-base'));
		expect(
			displayWorkstreamName(
				{
					id: 'workstream-prefixed-main',
					name: 'bookstore / main',
					baseBranch: 'master',
				},
				'szymeo/bookstore',
			),
		).toBe(generatedWorkstreamName('workstream-prefixed-main'));
	});

	it('keeps intentional custom names', () => {
		expect(
			displayWorkstreamName({
				id: 'workstream-custom',
				name: 'Checkout billing fix',
				baseBranch: 'main',
			}),
		).toBe('Checkout billing fix');
	});

	it('drops repository prefixes when the workstream is already nested under the repository', () => {
		expect(
			displayWorkstreamName(
				{
					id: 'workstream-prefixed',
					name: 'blog.dev / Fix nav',
					baseBranch: 'main',
				},
				'szymeo/blog.dev',
			),
		).toBe('Fix nav');
		expect(
			displayWorkstreamName(
				{
					id: 'workstream-full-prefixed',
					name: 'szymeo/blog.dev: Tune layout',
					baseBranch: 'main',
				},
				'szymeo/blog.dev',
			),
		).toBe('Tune layout');
	});

	it('gives a new workstream the name its id picks when no other workstream has it', () => {
		expect(uniqueWorkstreamName('workstream-1', ['Some Other'])).toBe(
			generatedWorkstreamName('workstream-1'),
		);
	});

	it('never gives a new workstream the name of a workstream that already has it', () => {
		const wanted = generatedWorkstreamName('workstream-1');
		const name = uniqueWorkstreamName('workstream-1', [`  ${wanted.toUpperCase()} `]);
		expect(name.toLowerCase()).not.toBe(wanted.toLowerCase());
		expect(EVERY_GENERATED_NAME).toContain(name);
	});

	it('numbers the name once every generated name is taken', () => {
		const everyName = [...new Set(EVERY_GENERATED_NAME)];
		const wanted = generatedWorkstreamName('workstream-1');
		expect(uniqueWorkstreamName('workstream-1', everyName)).toBe(`${wanted} 2`);
		expect(uniqueWorkstreamName('workstream-1', [...everyName, `${wanted} 2`])).toBe(`${wanted} 3`);
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
