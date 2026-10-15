import type { BackgroundWork } from '$lib/chat/domain/background-work';
import type { SessionId } from '$lib/chat/domain/session';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';

export { backgroundWorkQuery };

class BackgroundWorkQuery {
	public readonly data: (sessionId: SessionId | null) => BackgroundWork | null = $derived(
		(sessionId: SessionId | null) => (sessionId ? chatOccupancy.backgroundWork(sessionId) : null),
	);
}

const backgroundWorkQuery = new BackgroundWorkQuery();
