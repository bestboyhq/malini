import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate } from '$shared/repositories/application/provisioning.testkit';
import { repositoryAvatarQuery } from '$shared/repositories/application/queries/repository-avatar.query.svelte';
import { repositoryAvatarsAggregate } from '$shared/repositories/infrastructure/aggregates/repository-avatars.aggregate.svelte';
import { loadRepositoryAvatarCommand } from './load-repository-avatar.command';

type OwnerAvatar = { mediaType: string; base64: string } | null;

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
	repositoryAvatarsAggregate.reset();
});

afterEach(() => {
	setPlatformForTest(null);
	repositoryAvatarsAggregate.reset();
});

function avatarCalls(): unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'repositories.owner-avatar')
		.map(({ args }) => args);
}

describe('loading a repository avatar', () => {
	it('answers null while loading and a data URL once the host answers', async () => {
		const answer = gate<OwnerAvatar>();
		platform.define('repositories.owner-avatar', () => answer.promise);
		const avatar = repositoryAvatarQuery.data;

		loadRepositoryAvatarCommand('bestboyhq/malini');

		expect(avatar('bestboyhq/malini')).toBeNull();
		expect(avatarCalls()).toEqual([{ owner: 'bestboyhq' }]);
		answer.resolve({ mediaType: 'image/png', base64: 'AAAA' });
		await vi.waitFor(() => expect(avatar('bestboyhq/malini')).toBe('data:image/png;base64,AAAA'));
	});

	it('asks once per owner however many rows share it', async () => {
		const answer = gate<OwnerAvatar>();
		platform.define('repositories.owner-avatar', () => answer.promise);

		loadRepositoryAvatarCommand('bestboyhq/malini');
		loadRepositoryAvatarCommand('bestboyhq/malini');
		answer.resolve({ mediaType: 'image/png', base64: 'AAAA' });
		await vi.waitFor(() =>
			expect(repositoryAvatarQuery.data('bestboyhq/malini')).toBe('data:image/png;base64,AAAA'),
		);
		loadRepositoryAvatarCommand('bestboyhq/other');

		expect(avatarCalls()).toHaveLength(1);
	});

	it('remembers a missing owner without asking again', async () => {
		loadRepositoryAvatarCommand('nobody/repo');
		await vi.waitFor(() => expect(repositoryAvatarsAggregate.entries).toHaveProperty('nobody'));

		loadRepositoryAvatarCommand('nobody/repo');

		expect(repositoryAvatarQuery.data('nobody/repo')).toBeNull();
		expect(avatarCalls()).toHaveLength(1);
	});

	it('treats a rejected request as missing rather than throwing', async () => {
		platform.define('repositories.owner-avatar', () => {
			throw new Error('offline');
		});

		loadRepositoryAvatarCommand('bestboyhq/malini');
		await vi.waitFor(() => expect(repositoryAvatarsAggregate.entries).toHaveProperty('bestboyhq'));
		loadRepositoryAvatarCommand('bestboyhq/malini');

		expect(repositoryAvatarQuery.data('bestboyhq/malini')).toBeNull();
		expect(avatarCalls()).toHaveLength(1);
	});

	it('never asks for a repository without a GitHub owner', () => {
		loadRepositoryAvatarCommand('malini');
		loadRepositoryAvatarCommand('work/malini/checkout');

		expect(repositoryAvatarQuery.data('malini')).toBeNull();
		expect(avatarCalls()).toEqual([]);
	});
});
