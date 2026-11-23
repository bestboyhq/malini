import type { SandboxSetupOutcome } from '$contract/agent';
import {
	PROVIDERS_SANDBOX_SETUP_PROGRESS_CHANNEL,
	type InstallProgressPayload,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WindowsSandboxService {
	setUp(replace: boolean): Promise<SandboxSetupOutcome> {
		return invoke('providers.set-up-sandbox', { replace });
	}

	remove(): Promise<SandboxSetupOutcome> {
		return invoke('providers.remove-sandbox', undefined);
	}

	onProgress(listener: (progress: InstallProgressPayload) => void): () => void {
		return onPlatformEvent(PROVIDERS_SANDBOX_SETUP_PROGRESS_CHANNEL, listener);
	}
}

export const windowsSandboxService = new WindowsSandboxService();
