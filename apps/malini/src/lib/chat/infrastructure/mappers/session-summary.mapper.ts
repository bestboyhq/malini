import type { AgentSessionSummary as RawSessionSummary } from '$contract/agent';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import { sessionStateFromReported } from '$lib/chat/domain/session-record';

export class SessionSummaryMapper {
	static fromRawList(raws: readonly RawSessionSummary[]): ChatSessionSummary[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawSessionSummary): ChatSessionSummary {
		return {
			id: raw.id,
			workstreamId: raw.workstreamId,
			displayName: raw.displayName,
			model: raw.model,
			status: sessionStateFromReported(raw.status),
			startedAt: raw.startedAt,
		};
	}
}
