import { afterEach, describe, expect, it } from 'vitest';
import { publishGithubCredentialStored } from '$shared/auth/auth-session-events';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { planWorkstreamProvisioning } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { resumeProvisioningOnGithubCredentialHook } from './resume-provisioning-on-github-credential.hook';

const WAITING = '01WAITINGONGITHUB';

function stageWaitingOnGithub(): void {
	workstreamProvisioning.begin(
		planWorkstreamProvisioning({
			repo: {
				fullName: 'rabbits/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				localPath: null,
			},
			projects: [],
			workstreamId: WAITING,
		}),
	);
	workstreamProvisioning.fail(WAITING, 'git auth failed for https://github.com/rabbits/hutch');
}

afterEach(() => {
	setPlatformForTest(null);
	workstreamProvisioning.reset();
});

describe('resuming setup when a GitHub credential lands', () => {
	it('resumes from the credential itself, and stops once released', () => {
		setPlatformForTest(createFakePlatform({ projects: [], workstreams: [] }));
		const release = resumeProvisioningOnGithubCredentialHook();

		stageWaitingOnGithub();
		publishGithubCredentialStored();
		expect(workstreamProvisioning.get(WAITING)?.failure).toBeNull();

		release();
		workstreamProvisioning.reset();
		stageWaitingOnGithub();
		publishGithubCredentialStored();
		expect(workstreamProvisioning.get(WAITING)?.failure).not.toBeNull();
	});
});
