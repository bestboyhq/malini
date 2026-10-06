import type { SessionId } from '$lib/chat/domain/session';

interface QueueInterruptRecovery {
	entryId: string;
	sessionId: SessionId;
	attempts: number;
	timer: ReturnType<typeof setTimeout>;
}

class QueueInterruptRecoveryStore {
	#byWorkstream = new Map<string, QueueInterruptRecovery>();

	get(workstreamId: string): QueueInterruptRecovery | undefined {
		return this.#byWorkstream.get(workstreamId);
	}

	set(workstreamId: string, recovery: QueueInterruptRecovery): void {
		this.#byWorkstream.set(workstreamId, recovery);
	}

	delete(workstreamId: string): void {
		this.#byWorkstream.delete(workstreamId);
	}

	workstreamIds(): string[] {
		return [...this.#byWorkstream.keys()];
	}
}

export const queueInterruptRecoveryStore = new QueueInterruptRecoveryStore();
