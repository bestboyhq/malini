import { describe, expect, it } from 'vitest';
import type { Repository } from '$shared/repositories/domain/repository';
import { groupItems, repositoryGroups } from './repository-groups';

const repo = (fullName: string): Repository => ({
	id: fullName,
	fullName,
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: null,
	createdAt: '2026-10-24T00:00:00.000Z',
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
