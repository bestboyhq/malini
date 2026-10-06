import { describe, expect, it } from 'vitest';
import {
	listExtensionWorkstreamsForAnchor,
	optionalExtensionText,
	requireExtensionWorkstreamForAnchor,
	requiredExtensionText,
} from './extension-workstream-scope';
import type { Workstream } from './workstream';

function workstream(overrides: Partial<Workstream>): Workstream {
	return {
		id: 'anchor',
		projectId: 'project',
		name: 'Anchor',
		path: '/tmp/worktrees/anchor',
		branch: 'malini/anchor',
		baseBranch: 'main',
		status: 'active',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
		...overrides,
	};
}

const workstreams: readonly Workstream[] = [
	workstream({}),
	workstream({ id: 'same-project', name: 'SMK-42 preview', branch: 'smk-42-preview' }),
	workstream({
		id: 'other-project',
		projectId: 'other-project',
		name: 'SMK-42 preview',
		branch: 'smk-42-preview',
	}),
	workstream({ id: 'archived', name: 'Archived', branch: 'archived', status: 'archived' }),
];

describe('extension workstream navigation scope', () => {
	it('lists only active workstreams from the anchor repository', () => {
		expect(listExtensionWorkstreamsForAnchor('anchor', workstreams)).toEqual([
			{ id: 'anchor', name: 'Anchor', branch: 'malini/anchor' },
			{ id: 'same-project', name: 'SMK-42 preview', branch: 'smk-42-preview' },
		]);
	});

	it('rejects cross-repository navigation even when names and branches match', () => {
		expect(() =>
			requireExtensionWorkstreamForAnchor('other-project', 'anchor', workstreams),
		).toThrow('Unknown workstream for the active repository');
		expect(requireExtensionWorkstreamForAnchor('same-project', 'anchor', workstreams).id).toBe(
			'same-project',
		);
	});

	it('requires an anchor that is still active', () => {
		expect(() => listExtensionWorkstreamsForAnchor(' ', workstreams)).toThrow(
			'Workstream navigation requires an active workstream',
		);
		expect(() => listExtensionWorkstreamsForAnchor('archived', workstreams)).toThrow(
			'The active workstream is no longer available',
		);
	});

	it('trims required and optional text from an extension', () => {
		expect(requiredExtensionText(' linear ', 'Source provider')).toBe('linear');
		expect(() => requiredExtensionText('  ', 'Source provider')).toThrow(
			'Source provider cannot be empty',
		);
		expect(optionalExtensionText('title', ' SMK-42 ')).toEqual({ title: 'SMK-42' });
		expect(optionalExtensionText('url', '  ')).toEqual({});
	});
});
