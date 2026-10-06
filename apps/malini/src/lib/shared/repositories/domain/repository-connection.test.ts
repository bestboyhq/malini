import { describe, expect, it } from 'vitest';
import { GitHubAuthRequiredError } from './github-auth';
import type { Repository } from './repository';
import {
	isCloneUrl,
	repositoryConnectFailure,
	repositoryConnectionFor,
	repositoryMatchesImportSource,
	workstreamsForRepository,
} from './repository-connection';
import { UNOBSERVED_WORKSTREAM_CHECKOUT, type Workstream } from './workstream';

const remote: Repository = {
	id: 'repo-1',
	fullName: 'rabbits/hutch',
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: 'https://github.com/rabbits/hutch.git',
	createdAt: '2026-01-01T00:00:00.000Z',
};

function workstream(id: string, projectId: string): Workstream {
	return {
		id,
		projectId,
		name: id,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
	};
}

describe('connecting a repository', () => {
	it('accepts a URL or an scp-style remote as something git can clone', () => {
		expect(isCloneUrl('https://github.com/rabbits/hutch.git')).toBe(true);
		expect(isCloneUrl('git@github.com:rabbits/hutch.git')).toBe(true);
		expect(isCloneUrl('  ')).toBe(false);
		expect(isCloneUrl('rabbits/hutch')).toBe(false);
	});

	it('names the connection by what the user asked for', () => {
		expect(repositoryConnectionFor({ kind: 'local-folder', path: '/tmp/hutch' })).toEqual({
			kind: 'folder',
			key: 'folder:/tmp/hutch',
		});
		expect(repositoryConnectionFor({ kind: 'clone-url', url: 'https://x.test/a/b' })).toEqual({
			kind: 'clone',
			key: 'clone:https://x.test/a/b',
		});
	});

	it('explains a failure in the user’s words', () => {
		expect(
			repositoryConnectFailure(
				new Error('git clone failed: repository rabbits/hutch not found'),
				'Failed',
				{ kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' },
			),
		).toMatchObject({ detail: "GitHub didn't give access to rabbits/hutch." });
		expect(
			repositoryConnectFailure(
				Object.assign(new Error("GitHub couldn't find rabbits/hutch."), {
					kind: 'repository-not-found',
				}),
				'Failed',
				{ kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' },
			),
		).toMatchObject({ detail: "GitHub didn't give access to rabbits/hutch." });
		expect(repositoryConnectFailure(new Error('worktrees are locked'), 'Failed')).toEqual({
			detail: 'workstreams are locked',
			remedy: null,
			technical: null,
		});
		expect(repositoryConnectFailure(new GitHubAuthRequiredError(), 'Failed').remedy).toContain(
			'gh auth login',
		);
		expect(repositoryConnectFailure(42, 'Failed to connect repository').detail).toBe(
			'Failed to connect repository',
		);
	});

	it('reads what went wrong from the failure kind, not from its wording', () => {
		const loginPrompt = Object.assign(new Error('terminal prompts disabled'), {
			kind: 'auth-failed',
		});
		const expiredSignIn = Object.assign(new Error('HTTP 401: Bad credentials'), {
			kind: 'auth-required',
		});

		expect(repositoryConnectFailure(loginPrompt, 'Failed').detail).toBe(
			"GitHub didn't give access to this repository.",
		);
		expect(repositoryConnectFailure(expiredSignIn, 'Failed').remedy).toBe(
			'Reconnect it with `gh auth login` in a terminal, then try again.',
		);
	});

	it('matches an already connected record to the folder or remote the user picked', () => {
		expect(
			repositoryMatchesImportSource(remote, {
				kind: 'clone-url',
				url: 'HTTPS://github.com/rabbits/hutch/',
			}),
		).toBe(true);
		expect(
			repositoryMatchesImportSource(
				{ ...remote, localPath: '/tmp/hutch', remoteUrl: null },
				{ kind: 'local-folder', path: '/tmp/hutch/' },
			),
		).toBe(true);
		expect(
			repositoryMatchesImportSource(remote, { kind: 'local-folder', path: '/tmp/hutch' }),
		).toBe(false);
	});

	it('finds the workstreams that belong to a repository', () => {
		const workstreams = [
			workstream('mine', 'local__rabbits__hutch'),
			workstream('other', 'local__foxes__den'),
		];

		expect(workstreamsForRepository(remote, workstreams).map(({ id }) => id)).toEqual(['mine']);
		expect(
			workstreamsForRepository(
				{ ...remote, id: 'local:local__foxes__den', fullName: 'den', remoteUrl: null },
				workstreams,
			).map(({ id }) => id),
		).toEqual(['other']);
	});
});
