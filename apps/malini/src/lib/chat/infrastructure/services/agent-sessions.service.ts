import type { SendAgentPromptArgs, StartAgentSessionArgs } from '$contract/commands';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { AgentEventMapper } from '$lib/chat/infrastructure/mappers/agent-event.mapper';
import { SessionSummaryMapper } from '$lib/chat/infrastructure/mappers/session-summary.mapper';
import { invoke } from '$shared/port/invoke';

class AgentSessionsService {
	async list(workstreamId: string): Promise<ChatSessionSummary[]> {
		const raws = await invoke('chat.list-sessions', { workstreamId });
		return SessionSummaryMapper.fromRawList(raws);
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

	async listEvents(sessionId: SessionId, afterSeq: number): Promise<EventEnvelope[]> {
		const raws = await invoke('chat.list-events', { sessionId, afterSeq });
		return AgentEventMapper.fromRawList(raws);
	}

	async listRecentEvents(
		sessionId: SessionId,
		byteBudget: number,
	): Promise<Readonly<{ envelopes: EventEnvelope[]; overBudget: boolean }>> {
		const recent = await invoke('chat.list-recent-events', { sessionId, byteBudget });
		return {
			envelopes: AgentEventMapper.fromRawList(recent.envelopes),
			overBudget: recent.overBudget,
		};
	}
}

export const agentSessions = new AgentSessionsService();
