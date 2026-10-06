import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionWorkstreamEnsureInput } from '@malini/extension-api';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { extensionNavigationBindingService as binding } from './extension-navigation-binding.service';

const RESERVATIONS_KEY = 'malini.chat.extension-workstream-reservations.v1';

const router = vi.hoisted(() => ({
	goto: vi.fn(async (_href: string) => undefined),
	params: { workstreamId: undefined as string | undefined },
}));

const identity = vi.hoisted(() => ({ nextWorkstreamId: vi.fn(() => 'linear-workstream') }));

vi.mock('$shared/router/navigation', () => ({ goto: router.goto }));
vi.mock('$shared/router/state', () => ({
	page: {
		get params() {
			return router.params;
		},
	},
}));
vi.mock(import('$shared/repositories/domain/project-identity'), async (importOriginal) => ({
	...(await importOriginal()),
	nextWorkstreamId: identity.nextWorkstreamId,
}));

let platform: FakePlatform;

beforeEach(async () => {
	localStorage.clear();
	router.goto.mockClear();
	router.params = { workstreamId: 'anchor' };
	identity.nextWorkstreamId.mockClear();
	platform = createFakePlatform({
		projects: [
			{ id: 'project', name: 'malini', repoPath: '/tmp/malini-repo', defaultBranch: 'main' },
		],
		workstreams: [
			fakeWorkstream('anchor', { baseBranch: 'develop' }),
			fakeWorkstream('same-project'),
			fakeWorkstream('other-project', { projectId: 'other-project' }),
		],
	});
	setPlatformForTest(platform);
	workstreamsAggregate.reset();
	await workstreamsAggregate.refresh();
});

afterEach(() => {
	vi.restoreAllMocks();
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	localStorage.clear();
});

function fakeWorkstream(
	id: string,
	overrides: Partial<{ projectId: string; baseBranch: string; status: Workstream['status'] }> = {},
) {
	return {
		id,
		projectId: overrides.projectId ?? 'project',
		name: id,
		path: `/tmp/worktrees/${id}`,
		branch: `malini/${id}`,
		baseBranch: overrides.baseBranch ?? 'main',
		status: overrides.status ?? 'active',
	};
}

function linearInput(): ExtensionWorkstreamEnsureInput {
	return {
		name: ' SMK-42 · Preview readiness ',
		task: ' Start Preview after Docker is ready. ',
		source: {
			provider: ' linear ',
			resourceId: ' issue-42 ',
			title: ' SMK-42 · Preview readiness ',
			url: ' https://linear.app/acme/issue/SMK-42 ',
		},
	};
}

function createCalls(): unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'repositories.create-workstream')
		.map(({ args }) => args);
}

describe('the extension navigation binding', () => {
	it('lists workstreams for the active anchor from the loaded scope', async () => {
		await expect(binding.listWorkstreams()).resolves.toEqual([
			{ id: 'anchor', name: 'anchor', branch: 'malini/anchor' },
			{ id: 'same-project', name: 'same-project', branch: 'malini/same-project' },
		]);
	});

	it('refuses every call while the workstreams are still loading', async () => {
		workstreamsAggregate.reset();

		await expect(binding.listWorkstreams()).rejects.toThrow('Workstreams are still loading');
		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow(
			'Workstreams are still loading',
		);
		await expect(binding.openWorkstream({ workstreamId: 'anchor' })).rejects.toThrow(
			'Workstreams are still loading',
		);
		expect(createCalls()).toEqual([]);
		expect(router.goto).not.toHaveBeenCalled();
	});

	it('creates in the anchor project, keeps the source context for setup, and shows the new row', async () => {
		await expect(binding.ensureWorkstream(linearInput())).resolves.toEqual({
			id: 'linear-workstream',
			name: 'SMK-42 · Preview readiness',
			branch: 'malini/linear-workstream',
		});

		expect(createCalls()).toEqual([
			{
				projectRepoPath: '/tmp/malini-repo',
				workstreamId: 'linear-workstream',
				baseBranch: 'develop',
				projectId: 'project',
				name: 'SMK-42 · Preview readiness',
			},
		]);
		expect(workstreamsAggregate.workstreams.find(({ id }) => id === 'linear-workstream')).toEqual({
			id: 'linear-workstream',
			projectId: 'project',
			name: 'SMK-42 · Preview readiness',
			path: '/tmp/malini/workstreams/linear-workstream',
			branch: 'malini/linear-workstream',
			baseBranch: 'develop',
			status: 'active',
			checkoutState: 'unobserved',
			checkoutIssue: null,
			resolvedPath: null,
		});
		expect(
			JSON.parse(localStorage.getItem('malini.chat.created-workstream-context-v1') ?? '{}'),
		).toEqual({
			'linear-workstream': {
				task: 'Start Preview after Docker is ready.',
				source: {
					provider: 'linear',
					resourceId: 'issue-42',
					title: 'SMK-42 · Preview readiness',
					url: 'https://linear.app/acme/issue/SMK-42',
				},
			},
		});
	});

	it('selects the reserved workstream instead of creating a second one', async () => {
		const first = await binding.ensureWorkstream(linearInput());
		const second = await binding.ensureWorkstream(linearInput());

		expect(second).toEqual(first);
		expect(identity.nextWorkstreamId).toHaveBeenCalledOnce();
		expect(createCalls()).toHaveLength(1);
	});

	it('retries a failed native create with the same reserved workstream id', async () => {
		let failNext = true;
		platform.define('repositories.create-workstream', (input) => {
			if (failNext) {
				failNext = false;
				throw new Error('clone interrupted');
			}
			return `/tmp/malini/workstreams/${input.workstreamId}`;
		});

		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow('clone interrupted');
		await expect(binding.ensureWorkstream(linearInput())).resolves.toMatchObject({
			id: 'linear-workstream',
		});
		expect(identity.nextWorkstreamId).toHaveBeenCalledOnce();
	});

	it('fails before native creation when the reservation cannot be saved', async () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage full');
		});

		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow(
			'Could not reserve the extension workstream safely',
		);
		expect(createCalls()).toEqual([]);
	});

	it('refuses corrupted reservations instead of guessing', async () => {
		localStorage.setItem(RESERVATIONS_KEY, '{"version":2,"entries":{}}');

		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow(
			'reservations are corrupted',
		);
		expect(createCalls()).toEqual([]);
	});

	it('refuses to create without an active anchor workstream', async () => {
		router.params = { workstreamId: undefined };

		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow(
			'Create an extension workstream from an active workstream',
		);
		router.params = { workstreamId: 'missing' };
		await expect(binding.ensureWorkstream(linearInput())).rejects.toThrow(
			'The active workstream is no longer available',
		);
		expect(createCalls()).toEqual([]);
	});

	it('opens a workstream the anchor project owns and navigates to it', async () => {
		await binding.openWorkstream({ workstreamId: 'same-project' });

		expect(router.goto).toHaveBeenCalledWith('/workstreams/same-project');
	});

	it('surfaces a workstream of another repository without navigating', async () => {
		await expect(binding.openWorkstream({ workstreamId: 'other-project' })).rejects.toThrow(
			'Unknown workstream for the active repository: other-project',
		);
		expect(router.goto).not.toHaveBeenCalled();
	});
});
