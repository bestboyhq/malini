import { listenGithubCredentialStored } from '$shared/auth/auth-session-events';
import { resumeProvisioningWaitingOnGithubCommand } from '$shared/repositories/application/commands/resume-provisioning-waiting-on-github.command';

export function resumeProvisioningOnGithubCredentialHook(): () => void {
	return listenGithubCredentialStored(resumeProvisioningWaitingOnGithubCommand);
}
