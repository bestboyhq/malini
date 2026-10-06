import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedRepositoryDto } from '$contract/repositories';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import type { Repository } from '$shared/repositories/domain/repository';
import { repositoriesAggregate, sortByCreatedAtDesc } from './repositories.aggregate.svelte';

const gatewayMock = {
	listRepositories: vi.fn<() => Promise<ConnectedRepositoryDto[]>>(),
	connectRepository: vi.fn<() => Promise<ConnectedRepositoryDto>>(),
	disconnectRepository: vi.fn<() => Promise<void>>(),
};

function dto(repo: Repository): ConnectedRepositoryDto {
	return { ...repo };
}

function repoFixture(overrides: Partial<Repository> = {}): Repository {
	return {
		id: '01JMALINIREPOSITORYMALINI00000000A',
		fullName: 'bestboyhq/malini',
		defaultBranch: 'main',
		localPath: '/Users/dev/code/malini',
		remoteUrl: 'https://github.com/bestboyhq/malini.git',
		createdAt: '2026-06-14T09:00:00.000Z',
		...overrides,
	};
}

const IMPORT_SOURCE = {
	kind: 'clone-url',
	url: 'https://github.com/bestboyhq/mobile-app.git',
} as const;

describe('RepositoriesAggregate', () => {
	beforeEach(() => {
		repositoriesAggregate.reset();
		gatewayMock.listRepositories.mockReset();
		gatewayMock.connectRepository.mockReset();
		gatewayMock.disconnectRepository.mockReset();
		const fake = createFakePlatform();
		fake.define('repositories.list-clones', gatewayMock.listRepositories);
		fake.define('repositories.connect', gatewayMock.connectRepository);
		fake.define('repositories.disconnect', gatewayMock.disconnectRepository);
		setPlatformForTest(fake);
	});

	afterEach(() => {
		setPlatformForTest(null);
		vi.clearAllMocks();
	});

	it('keeps a newly connected repository out of the list until its connect is revealed', async () => {
		const first = repoFixture();
		const created = repoFixture({
			id: '01JMALINIREPOSITORYMALINI00000000C',
			fullName: 'bestboyhq/mobile-app',
			createdAt: '2026-06-20T09:00:00.000Z',
		});
		gatewayMock.listRepositories.mockResolvedValue([dto(first)]);
		gatewayMock.connectRepository.mockResolvedValueOnce(dto(created));
		await repositoriesAggregate.refresh();

		await repositoriesAggregate.connect(IMPORT_SOURCE);
		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual([first.id]);
		gatewayMock.listRepositories.mockResolvedValue([dto(created), dto(first)]);
		await repositoriesAggregate.refresh();
		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual([first.id]);

		repositoriesAggregate.reveal(created.id);
		await repositoriesAggregate.refresh();
		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual([created.id, first.id]);
	});

	it('leaves the list and its load error alone when a connect is refused', async () => {
		const first = repoFixture();
		gatewayMock.listRepositories.mockResolvedValueOnce([dto(first)]);
		await repositoriesAggregate.refresh();

		gatewayMock.connectRepository.mockRejectedValueOnce(new Error('clone failed'));
		await expect(repositoriesAggregate.connect(IMPORT_SOURCE)).rejects.toThrow('clone failed');

		expect(repositoriesAggregate.items).toEqual([first]);
		expect(repositoriesAggregate.lastError).toBeNull();
	});

	it('confirms an optimistic disconnect that the platform accepts', async () => {
		const first = repoFixture();
		const second = repoFixture({
			id: '01JMALINIREPOSITORYMALINI00000000B',
			fullName: 'bestboyhq/design-system',
			createdAt: '2026-06-15T09:00:00.000Z',
		});
		gatewayMock.listRepositories.mockResolvedValueOnce([dto(first), dto(second)]);
		await repositoriesAggregate.refresh();

		gatewayMock.disconnectRepository.mockResolvedValueOnce(undefined);
		await expect(repositoriesAggregate.disconnect(second.id)).resolves.toBe('confirmed');

		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual([first.id]);
	});

	it('restores a rejected disconnect with its prior ordering', async () => {
		const first = repoFixture();
		const second = repoFixture({
			id: '01JMALINIREPOSITORYMALINI00000000B',
			fullName: 'bestboyhq/design-system',
			createdAt: '2026-06-15T09:00:00.000Z',
		});
		gatewayMock.listRepositories.mockResolvedValueOnce([dto(second), dto(first)]);
		await repositoriesAggregate.refresh();
		const before = repositoriesAggregate.items.map(({ id }) => id);

		gatewayMock.disconnectRepository.mockRejectedValueOnce(new Error('still in use'));
		await expect(repositoriesAggregate.disconnect(second.id)).resolves.toBe('rolled-back');

		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual(before);
		expect(repositoriesAggregate.lastError).toBe('still in use');
	});

	it('sorts items by createdAt descending regardless of arrival order', () => {
		const older = repoFixture({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' });
		const newer = repoFixture({ id: 'newer', createdAt: '2026-02-01T00:00:00.000Z' });
		expect(sortByCreatedAtDesc([older, newer]).map(({ id }) => id)).toEqual(['newer', 'older']);
	});

	it('records a refresh failure without dropping the cached items', async () => {
		const first = repoFixture();
		gatewayMock.listRepositories.mockResolvedValueOnce([dto(first)]);
		await repositoriesAggregate.refresh();

		gatewayMock.listRepositories.mockRejectedValueOnce(new Error('offline'));
		await repositoriesAggregate.refresh();

		expect(repositoriesAggregate.items).toEqual([first]);
		expect(repositoriesAggregate.lastError).toBe('offline');
		expect(repositoriesAggregate.loading).toBe(false);
	});

	it('ignores a late response from a superseded refresh', async () => {
		let releaseFirst!: (repos: ConnectedRepositoryDto[]) => void;
		gatewayMock.listRepositories
			.mockImplementationOnce(
				() =>
					new Promise<ConnectedRepositoryDto[]>((resolve) => {
						releaseFirst = resolve;
					}),
			)
			.mockResolvedValueOnce([dto(repoFixture({ id: 'second' }))]);

		const first = repositoriesAggregate.refresh();
		const second = repositoriesAggregate.refresh();
		await second;
		releaseFirst([dto(repoFixture({ id: 'first' }))]);
		await first;

		expect(repositoriesAggregate.items.map(({ id }) => id)).toEqual(['second']);
	});
});
