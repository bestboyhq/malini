import type { AgentSessionSummary as RawSessionSummary } from '$contract/agent';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import { sessionStateFromReported } from '$lib/chat/domain/session-record';
import { DEFAULT_PROVIDER_ID } from '$shared/providers/providers.api';

export class SessionSummaryMapper {
	static fromRawList(raws: readonly RawSessionSummary[]): ChatSessionSummary[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawSessionSummary): ChatSessionSummary {
		return {
			id: raw.id,
			workstreamId: raw.workstreamId,
			displayName: raw.displayName,
			provider: raw.provider ?? DEFAULT_PROVIDER_ID,
			model: raw.model,
			status: sessionStateFromReported(raw.status),
			startedAt: raw.startedAt,
			origin: raw.origin,
		};
	}
}
