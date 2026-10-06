import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { planWorkstreamProvisioning } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { resumeProvisioningWaitingOnGithubCommand } from './resume-provisioning-waiting-on-github.command';

function stageFailedWorkstream(workstreamId: string, failure: string): void {
	workstreamProvisioning.begin(
		planWorkstreamProvisioning({
			repo: {
				fullName: 'bestboyhq/grip',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/bestboyhq/grip.git',
				localPath: null,
			},
			projects: [],
			workstreamId,
		}),
	);
	workstreamProvisioning.fail(workstreamId, failure);
}

beforeEach(() => {
	setPlatformForTest(createFakePlatform({ projects: [], workstreams: [] }));
	workstreamProvisioning.reset();
});

afterEach(() => {
	setPlatformForTest(null);
	workstreamProvisioning.reset();
});

describe('setup waiting on a GitHub credential', () => {
	it('resumes only the attempts that stopped for want of a credential', () => {
		stageFailedWorkstream('01WAITING', 'git auth failed for https://github.com/bestboyhq/grip');
		stageFailedWorkstream('01UNRELATED', 'base branch main is missing');

		resumeProvisioningWaitingOnGithubCommand();

		expect(workstreamProvisioning.get('01WAITING')?.failure).toBeNull();
		expect(workstreamProvisioning.get('01UNRELATED')?.failure).toBe('base branch main is missing');
	});
});
