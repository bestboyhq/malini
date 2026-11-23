import {
	REPOSITORIES_GIT_INSTALL_PROGRESS_CHANNEL,
	type InstallProgressPayload,
} from '$contract/events';
import type { GitSetupStatus } from '$contract/repositories';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class GitSetupService {
	status(): Promise<GitSetupStatus> {
		return invoke('repositories.git-setup-status', undefined);
	}

	install(): Promise<void> {
		return invoke('repositories.install-git', undefined);
	}

	onInstallProgress(listener: (progress: InstallProgressPayload) => void): () => void {
		return onPlatformEvent(REPOSITORIES_GIT_INSTALL_PROGRESS_CHANNEL, listener);
	}
}

export const gitSetupService = new GitSetupService();
