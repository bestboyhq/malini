import { CHAT_RUN_CHANGES_CAPTURED_CHANNEL } from '$contract/events';
import { AgentSessionFileDiffExtensionTarget } from '$lib/chat/infrastructure/services/agent-session-file-diff-target.service';
import {
	LatestAgentSessionChangesQuery,
	OpenAgentSessionChangedFileCommand,
} from '$lib/chat/infrastructure/services/agent-session-changes.service';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';
import type {
	AgentSessionChangePatch,
	AgentSessionChangeScope,
	AgentSessionChangedFile,
	AgentSessionChanges,
} from '$shared/repositories/repositories.api';

const sessionChangesPort = Object.freeze({
	getSessionChanges(
		input: AgentSessionChangeScope & Readonly<{ sessionId: string }>,
	): Promise<AgentSessionChanges> {
		return invoke('chat.session-changes', input);
	},
	getSessionChangePatch(
		input: AgentSessionChangeScope & Readonly<{ sessionId: string; path: string }>,
	): Promise<AgentSessionChangePatch> {
		return invoke('chat.session-change-patch', input);
	},
});

class ChatSessionChangesService {
	readonly #latest = new LatestAgentSessionChangesQuery(sessionChangesPort);
	readonly #open = new OpenAgentSessionChangedFileCommand(
		sessionChangesPort,
		new AgentSessionFileDiffExtensionTarget(),
	);

	async load(input: {
		workstreamId: string;
		sessionId: string;
	}): Promise<AgentSessionChanges | null> {
		return await this.#latest.execute({
			workstreamId: input.workstreamId,
			sessionId: input.sessionId,
		});
	}

	async openChangedFile(input: {
		workstreamId: string;
		changes: AgentSessionChanges;
		file: AgentSessionChangedFile;
	}): Promise<void> {
		await this.#open.execute({
			scope: { workstreamId: input.workstreamId },
			changes: input.changes,
			file: input.file,
		});
	}

	cancel(): void {
		this.#latest.cancel();
		this.#open.cancel();
	}

	onCaptured(listener: (sessionId: string) => void): () => void {
		return onPlatformEvent(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, ({ sessionId }) =>
			listener(sessionId),
		);
	}
}

export const chatSessionChanges = new ChatSessionChangesService();
