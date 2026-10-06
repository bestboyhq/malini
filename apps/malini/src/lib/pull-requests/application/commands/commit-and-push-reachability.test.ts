import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import repositoryManifest from '@malini-extension/repository/manifest.json';
import type { RepositorySurfaceState } from '@malini-extension/repository';
import type {
	PullRequestAvailability,
	PullRequestTopBarPresentation,
} from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBarPresentation } from '$lib/pull-requests/domain/pull-request-top-bar';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';

const COMMIT_AND_PUSH = 'malini.repository.commit-and-push';

function topBar(
	raw: RepositorySurfaceState | null,
	availability: PullRequestAvailability = 'ready',
): PullRequestTopBarPresentation | null {
	return pullRequestTopBarPresentation(
		raw === null ? null : RepositorySurfaceMapper.fromRaw(raw),
		availability,
	);
}

const actionsMenuSource = readFileSync(
	new URL(
		'../../../shared/repositories/presentation/WorkstreamActionsMenu.svelte',
		import.meta.url,
	),
	'utf8',
);

function sourceFiles(root: URL): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'platform') {
			continue;
		}
		if (entry.isDirectory()) {
			files.push(...sourceFiles(new URL(`${entry.name}/`, root)));
			continue;
		}
		if (!/\.(?:ts|svelte)$/u.test(entry.name)) continue;
		if (/\.(?:test|spec)\.ts$/u.test(entry.name)) continue;
		files.push(fileURLToPath(new URL(entry.name, root)));
	}
	return files;
}

function surface(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'malini/workstream-1',
		baseBranch: 'main',
		dirtyPaths: ['src/index.ts'],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		changedFiles: 1,
		pullRequest: {
			state: 'open',
			number: 12,
			title: 'Ship the git actions',
			url: 'https://example.test/pull/12',
			baseBranch: 'main',
			headBranch: 'malini/workstream-1',
			checks: 'success',
		},
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 123,
		pullRequestSettledAt: 123,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		...overrides,
	};
}

describe('commit and push reachability', () => {
	it('declares one named commit-and-push command', () => {
		const commands = (repositoryManifest as { contributes: { commands: { id: string }[] } })
			.contributes.commands;
		expect(commands.map(({ id }) => id)).toContain(COMMIT_AND_PUSH);
	});

	it('names the operation the button performs, in one click from the top bar', () => {
		const presentation = topBar(surface(), 'ready');
		expect(presentation).toMatchObject({ kind: 'push', label: 'Commit and push', disabled: false });
	});

	it('leaves the pull request creating click on the pull request command', () => {
		const noPullRequest = surface({
			pullRequest: {
				state: 'not_open',
				number: null,
				title: null,
				url: null,
				baseBranch: 'main',
				headBranch: 'malini/workstream-1',
				checks: 'unknown',
			},
		});
		expect(topBar(noPullRequest, 'ready')).toMatchObject({
			kind: 'push',
			label: 'Commit and push',
		});
	});

	it('never commits with a hardcoded message', () => {
		const roots = [
			new URL('../../../../lib/', import.meta.url),
			new URL('../../../../renderer/', import.meta.url),
			new URL('../../../../../../../extensions/', import.meta.url),
		];
		const repositoryRoot = fileURLToPath(new URL('../../../../../../../', import.meta.url));
		const offenders = roots
			.flatMap((root) => sourceFiles(root))
			.filter((file) => /Agent changes/u.test(readFileSync(file, 'utf8')))
			.map((file) => file.slice(repositoryRoot.length));
		expect(offenders).toEqual([]);
	});

	it('derives the workstream menu commit message from the shared derivation', () => {
		expect(actionsMenuSource).toContain('commitWorkstreamCheckpointCommand(');
		expect(actionsMenuSource).not.toMatch(/commitWorkstreamCommand\(\s*workstreamId\s*,\s*['"`]/u);
	});
});

describe('resolve conflicts reachability', () => {
	it('offers the action on a purely local conflict with no pull request', () => {
		expect(
			topBar(
				surface({
					mergeInProgress: true,
					operationInProgress: 'merge',
					conflictedPaths: ['src/index.ts'],
					conflictMarkerPaths: ['src/index.ts'],
					pullRequest: null,
				}),
				'ready',
			),
		).toMatchObject({ kind: 'fix', label: 'Resolve conflicts', disabled: false });
	});
});
