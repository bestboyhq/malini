import { describe, expect, it } from 'vitest';
import { connectedRepositoryContexts } from '$shared/repositories/domain/repository-context';
import type { Repository } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { groupItems, repositoryGroups, showsInSidebar } from './repository-groups';

const repo = (fullName: string): Repository => ({
	id: fullName,
	fullName,
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: null,
	createdAt: '2026-10-24T00:00:00.000Z',
});

const stream = (id: string, projectId: string): Workstream => ({
	id,
	projectId,
	name: id,
	path: `/tmp/malini/workstreams/${id}`,
	branch: `malini/${id}`,
	baseBranch: 'main',
	status: 'active',
	checkoutState: 'healthy',
	checkoutIssue: null,
	resolvedPath: null,
});

describe('repositoryGroups', () => {
	it('groups an owner with more than one repository and keeps a lone one as it is', () => {
		const groups = repositoryGroups(
			[repo('acme/api'), repo('solo/site'), repo('folder'), repo('Acme/web')],
			(item) => item,
		);
		expect(
			groups.map((group) => [group.kind, group.id, groupItems(group).map((item) => item.id)]),
		).toEqual([
			['owner', 'owner:acme', ['acme/api', 'Acme/web']],
			['repository', 'solo/site', ['solo/site']],
			['repository', 'folder', ['folder']],
		]);
	});
});

describe('showsInSidebar', () => {
	it('lists a repository while it has open workstreams or while it is open', () => {
		const shown = [0, 1].flatMap((count) => {
			const [row] = connectedRepositoryContexts({
				repositories: [repo('acme/api')],
				workstreams: Array.from({ length: count }, (_, index) =>
					stream(`w${index}`, 'local__acme__api'),
				),
			});
			return [null, 'acme/api'].map((open) => (row ? showsInSidebar(row, open) : null));
		});
		expect(shown).toEqual([false, true, true, true]);
	});
});
