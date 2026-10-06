import { describe, expect, it } from 'vitest';
import { repositoriesFixture } from '$lib/chat/infrastructure/fixtures/seed';
import { RepositoryMapper } from './repository.mapper';

function sample() {
	const repo = repositoriesFixture[0];
	if (!repo) throw new Error('fixture is empty');
	return repo;
}

describe('RepositoryMapper', () => {
	it('maps a well-formed repository record into the Repository domain type', () => {
		const repo = sample();
		const raw = {
			id: repo.id,
			fullName: repo.fullName,
			defaultBranch: repo.defaultBranch,
			localPath: repo.localPath,
			remoteUrl: repo.remoteUrl,
			createdAt: repo.createdAt,
		};

		expect(RepositoryMapper.fromRaw(raw)).toEqual(repo);
	});

	it('coerces absent localPath and remoteUrl to null', () => {
		const repo = sample();
		const result = RepositoryMapper.fromRaw({
			id: repo.id,
			fullName: repo.fullName,
			defaultBranch: repo.defaultBranch,
			createdAt: repo.createdAt,
		});

		expect(result?.localPath).toBeNull();
		expect(result?.remoteUrl).toBeNull();
	});

	it('rejects a record missing a required field (id)', () => {
		const repo = sample();
		expect(
			RepositoryMapper.fromRaw({
				fullName: repo.fullName,
				defaultBranch: repo.defaultBranch,
				createdAt: repo.createdAt,
			}),
		).toBeNull();
	});

	it('rejects a record whose remoteUrl or localPath has the wrong type', () => {
		const repo = sample();
		expect(RepositoryMapper.fromRaw({ ...repo, remoteUrl: 42 })).toBeNull();
		expect(RepositoryMapper.fromRaw({ ...repo, localPath: 42 })).toBeNull();
	});

	it('rejects a payload that is null or not an object', () => {
		expect(RepositoryMapper.fromRaw(null)).toBeNull();
		expect(RepositoryMapper.fromRaw('totally fine payload')).toBeNull();
		expect(RepositoryMapper.fromRaw(81378197)).toBeNull();
		expect(RepositoryMapper.fromRaw([sample()])).toBeNull();
	});

	it('fromRawList maps an array and drops malformed records', () => {
		const repo = sample();
		const result = RepositoryMapper.fromRawList([repo, { id: 'broken' }, null, repo]);

		expect(result.map((entry) => entry.id)).toEqual([repo.id, repo.id]);
	});

	it('fromRawList returns [] for an empty or non-array payload', () => {
		expect(RepositoryMapper.fromRawList([])).toEqual([]);
		expect(RepositoryMapper.fromRawList(null)).toEqual([]);
		expect(RepositoryMapper.fromRawList({ id: 'anything' })).toEqual([]);
		expect(RepositoryMapper.fromRawList('not an array')).toEqual([]);
	});
});
