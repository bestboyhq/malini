import type { SendAgentPromptArgs, StartAgentSessionArgs } from '$contract/commands';
import { CHAT_SESSION_RENAMED_CHANNEL } from '$contract/events';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import type { EventPage } from '$lib/chat/domain/event-page';
import type { SessionId } from '$lib/chat/domain/session';
import { AgentEventMapper } from '$lib/chat/infrastructure/mappers/agent-event.mapper';
import { SessionSummaryMapper } from '$lib/chat/infrastructure/mappers/session-summary.mapper';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class AgentSessionsService {
	async list(workstreamId: string): Promise<ChatSessionSummary[]> {
		const raws = await invoke('chat.list-sessions', { workstreamId });
		return SessionSummaryMapper.fromRawList(raws);
	}

	onRenamed(listener: (sessionId: SessionId, name: string) => void): () => void {
		return onPlatformEvent(CHAT_SESSION_RENAMED_CHANNEL, ({ sessionId, name }) =>
			listener(sessionId, name),
		);
	}

	activate(sessionId: SessionId): Promise<void> {
		return invoke('chat.activate-session', { sessionId });
	}

	archive(sessionId: SessionId): Promise<void> {
		return invoke('chat.archive-session', { sessionId });
	}

	start(input: StartAgentSessionArgs): Promise<SessionId> {
		return invoke('chat.start-session', input);
	}

	sendPrompt(input: SendAgentPromptArgs): Promise<string> {
		return invoke('chat.send-prompt', input);
	}

	cancelRun(sessionId: SessionId, pendingRunId: string | null): Promise<void> {
		return invoke('chat.cancel-run', {
			sessionId,
			...(pendingRunId === null ? {} : { pendingRunId }),
		});
	}

	stopBackgroundTask(sessionId: SessionId, taskId: string): Promise<void> {
		return invoke('chat.stop-background-task', { sessionId, taskId });
	}

	resetWorkstreamRuns(workstreamId: string): Promise<number> {
		return invoke('chat.reset-workstream-runs', { workstreamId });
	}

	restartAgent(): Promise<void> {
		return invoke('chat.restart-agent', undefined);
	}

	hasOpenRun(workstreamId: string): Promise<boolean> {
		return invoke('chat.workstream-has-open-run', { workstreamId });
	}

	healthy(): Promise<boolean> {
		return invoke('chat.agent-health', undefined);
	}

	async listEventPage(
		sessionId: SessionId,
		range: Readonly<{ afterSeq: number; beforeSeq: number | null; byteBudget: number }>,
	): Promise<EventPage> {
		const page = await invoke('chat.list-event-page', { sessionId, ...range });
		return {
			envelopes: AgentEventMapper.fromRawList(page.envelopes),
			startSeq: page.startSeq,
			complete: page.complete,
			overBudget: page.overBudget,
		};
	}

	toolOutput(sessionId: SessionId, toolCallId: string): Promise<string | null> {
		return invoke('chat.tool-output', { sessionId, toolCallId });
	}
}

export const agentSessions = new AgentSessionsService();
