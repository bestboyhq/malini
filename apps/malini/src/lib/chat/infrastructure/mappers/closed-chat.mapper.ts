import type { ClosedAgentSessionSummary as RawClosedChat } from '$contract/agent';
import type { ClosedChat } from '$lib/chat/domain/closed-chat';

export class ClosedChatMapper {
	static fromRawList(raws: readonly RawClosedChat[]): ClosedChat[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawClosedChat): ClosedChat {
		return { id: raw.id, name: raw.displayName, model: raw.model, closedAt: raw.closedAt };
	}
}
