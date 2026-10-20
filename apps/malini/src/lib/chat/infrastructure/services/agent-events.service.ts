import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { AgentEventMapper } from '$lib/chat/infrastructure/mappers/agent-event.mapper';
import { onPlatformEvent } from '$shared/port/events';

class AgentEventsService {
	subscribe(listener: (envelope: EventEnvelope | null) => void): () => void {
		return onPlatformEvent(CHAT_AGENT_EVENT_CHANNEL, (payload) =>
			listener(AgentEventMapper.fromLive(payload)),
		);
	}
}

export const agentEvents = new AgentEventsService();
