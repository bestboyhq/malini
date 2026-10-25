import type { SessionId } from '$lib/chat/domain/session';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export { dismissChildQuestionCommand };

function dismissChildQuestionCommand(sessionId: SessionId): void {
	void (async () => {
		try {
			await agentRunner.cancelRun(sessionId, null);
		} catch (error) {
			captureRendererError('caught', error);
		}
	})();
}
