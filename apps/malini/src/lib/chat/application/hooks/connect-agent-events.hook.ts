import { appendEnvelopesCommand } from '$lib/chat/application/commands/append-envelopes.command';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export function connectAgentEventsHook(): () => void {
	agentEventStream.hold({
		appendEnvelopes: (batch) => {
			appendEnvelopesCommand(batch);
		},
	});
	void listenForLiveEvents();

	return () => {
		void agentEventStream.letGo();
	};
}

async function listenForLiveEvents(): Promise<void> {
	try {
		await agentEventStream.ensureStarted();
	} catch (error) {
		captureRendererError('caught', error);
	}
}
