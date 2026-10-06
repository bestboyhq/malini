import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { GitHubAuthRequiredError } from '$shared/repositories/domain/github-auth';
import { githubService } from './github.service';

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
});

afterEach(() => {
	setPlatformForTest(null);
});

describe('GitHub repository calls', () => {
	it('connects a repository and lists it back as a domain record', async () => {
		const connected = await githubService.connectRepository({
			kind: 'clone-url',
			url: 'https://github.com/rabbits/hutch.git',
		});

		expect(connected).toMatchObject({ fullName: 'rabbits/hutch', defaultBranch: 'main' });
		expect(connected).not.toHaveProperty('workstreamId');
		expect(await githubService.listRepositories()).toEqual([connected]);
		expect(platform.calls[0]).toEqual({
			command: 'repositories.connect',
			args: {
				source: { kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' },
			},
		});
	});

	it('turns a signed-out gh into the typed auth error the UI explains', async () => {
		platform.define('repositories.list-clones', () => {
			throw new Error('gh auth login is required');
		});

		const failure = githubService.listRepositories();

		await expect(failure).rejects.toBeInstanceOf(GitHubAuthRequiredError);
		await expect(failure).rejects.toThrow('gh auth login is required');
	});

	it('passes any other failure through untouched', async () => {
		const cause = new Error('network is unreachable');
		platform.define('repositories.github-auth-status', () => {
			throw cause;
		});

		await expect(githubService.authStatus()).rejects.toBe(cause);
	});
});
